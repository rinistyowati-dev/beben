import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cookie hanya diteruskan ke benable.com, tidak disimpan / tidak di-log di server.

type Body = {
  username?: string;
  userId?: number | string;
  apiToken?: string;
  cookieHeader?: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchText(url: string, headers: Record<string, string>, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json, text/html;q=0.9, */*;q=0.8", ...headers },
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "follow",
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(t);
  }
}

function tryJson(text: string): any | null {
  try { return JSON.parse(text); } catch { return null; }
}

/** Cari nilai pertama untuk kumpulan key, sedalam apa pun di objek JSON. */
function deepFind(obj: any, keys: string[], depth = 0): any {
  if (obj == null || depth > 8) return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) { const v = deepFind(item, keys, depth + 1); if (v !== undefined) return v; }
    return undefined;
  }
  if (typeof obj === "object") {
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    for (const v of Object.values(obj)) { const r = deepFind(v, keys, depth + 1); if (r !== undefined) return r; }
  }
  return undefined;
}

function deepFindArray(obj: any, keys: string[], depth = 0): any[] | null {
  if (obj == null || depth > 8) return null;
  if (typeof obj === "object" && !Array.isArray(obj)) {
    for (const k of keys) if (Array.isArray(obj[k])) return obj[k];
    for (const v of Object.values(obj)) { const r = deepFindArray(v, keys, depth + 1); if (r) return r; }
  }
  if (Array.isArray(obj)) for (const i of obj) { const r = deepFindArray(i, keys, depth + 1); if (r) return r; }
  return null;
}

function toNum(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeLists(arr: any[] | null, username?: string) {
  if (!arr) return [];
  return arr.slice(0, 100).map((l: any) => {
    const title = l?.title || l?.name || l?.list_name || "Untitled list";
    const slug = l?.slug || l?.url_slug || l?.path || "";
    const url = l?.url || l?.profile_url || (slug ? (String(slug).startsWith("http") ? slug : `https://benable.com/${username || ""}/${String(slug).replace(/^\//, "")}`) : undefined);
    return {
      title: String(title),
      url,
      items: toNum(l?.recommendations_count ?? l?.recs_count ?? l?.items_count ?? l?.count ?? l?.total_recommendations) ?? (Array.isArray(l?.recommendations) ? l.recommendations.length : null),
      cover: l?.cover_photo_url || l?.cover_url || l?.image_url || l?.photo_url || null,
    };
  });
}

/** Ambil jumlah list & daftar list dari HTML halaman profil publik. */
function parseProfileHtml(html: string, username: string) {
  const out: { listsCount: number | null; lists: any[]; followers: number | null; following: number | null } =
    { listsCount: null, lists: [], followers: null, following: null };

  const countPatterns = [
    /"(?:lists_count|list_count|total_lists|lists_total)"\s*:\s*(\d+)/i,
    /(\d+)\s*(?:Lists|lists)\b/,
  ];
  for (const p of countPatterns) { const m = html.match(p); if (m) { out.listsCount = parseInt(m[1], 10); break; } }

  // Link list profil berbentuk /{username}/{slug-list}
  if (username) {
    const esc = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`href="/${esc}/([a-z0-9][a-z0-9\\-]*)"`, "gi");
    const skip = new Set(["followers", "following", "lists", "about", "edit"]);
    const slugs = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) if (!skip.has(m[1])) slugs.add(m[1]);
    if (slugs.size) {
      out.lists = Array.from(slugs).map((s) => ({ title: s.replace(/-/g, " "), url: `https://benable.com/${username}/${s}`, items: null, cover: null }));
      if (out.listsCount === null) out.listsCount = slugs.size;
    }
  }
  const fol = html.match(/"(?:followers_count|follower_count)"\s*:\s*(\d+)/i);
  if (fol) out.followers = parseInt(fol[1], 10);
  const fing = html.match(/"(?:following_count)"\s*:\s*(\d+)/i);
  if (fing) out.following = parseInt(fing[1], 10);
  return out;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Body tidak valid" }, { status: 400 }); }

  const username = (body.username || "").replace(/^@/, "").trim();
  const userId = body.userId;
  const apiToken = (body.apiToken || "").trim();
  const cookieHeader = (body.cookieHeader || "").slice(0, 20000);

  // Hanya izinkan target benable.com (mencegah proxy dipakai untuk SSRF)
  const authHeaders: Record<string, string> = {};
  if (cookieHeader) authHeaders.Cookie = cookieHeader;
  const tokenHeaders: Record<string, string> = apiToken
    ? { Authorization: `Bearer ${apiToken}`, "X-Api-Token": apiToken }
    : {};

  const attempts: { url: string; status: number | string }[] = [];
  const result: any = {
    ok: false, username: username || null, source: [] as string[],
    listsCount: null, lists: [], cashback: null, pendingCashback: null,
    followers: null, following: null, name: null, avatarUrl: null,
  };

  const jsonUrls = [
    "https://benable.com/api/current_user",
    username ? `https://benable.com/api/users/${encodeURIComponent(username)}` : "",
    userId ? `https://benable.com/api/users/${encodeURIComponent(String(userId))}` : "",
    username ? `https://benable.com/api/users/${encodeURIComponent(username)}/lists` : "",
    username ? `https://benable.com/api/lists?username=${encodeURIComponent(username)}` : "",
    "https://benable.com/api/cashback",
    userId ? `https://benable.com/api/users/${encodeURIComponent(String(userId))}/cashback` : "",
  ].filter(Boolean);

  for (const url of jsonUrls) {
    try {
      const r = await fetchText(url, { ...authHeaders, ...tokenHeaders });
      attempts.push({ url: url.replace("https://benable.com", ""), status: r.status });
      if (!r.ok) continue;
      const json = tryJson(r.text);
      if (!json) continue;
      result.ok = true;
      result.source.push(url.replace("https://benable.com", ""));

      result.name ??= deepFind(json, ["name", "full_name"]) || null;
      result.avatarUrl ??= deepFind(json, ["avatar_url", "avatar"]) || null;
      const fol = toNum(deepFind(json, ["followers_count", "follower_count"]));
      const fing = toNum(deepFind(json, ["following_count"]));
      if (fol !== null) result.followers = fol;
      if (fing !== null) result.following = fing;

      const cb = deepFind(json, ["cashback"]);
      if (cb && typeof cb === "object") {
        const cents = toNum(cb.amount_in_cents);
        const disp = cb.display_amount != null ? toNum(cb.display_amount) : null;
        if (cents !== null) result.cashback = cents / 100; else if (disp !== null) result.cashback = disp;
        const pCents = toNum(cb.pending_amount_in_cents);
        const pDisp = cb.pending_display_amount != null ? toNum(cb.pending_display_amount) : null;
        if (pCents !== null) result.pendingCashback = pCents / 100; else if (pDisp !== null) result.pendingCashback = pDisp;
      }
      const directCb = toNum(deepFind(json, ["cashback_amount", "cashback_balance", "total_cashback"]));
      if (result.cashback === null && directCb !== null) result.cashback = directCb;

      const listsArr = deepFindArray(json, ["lists", "user_lists", "collections"]);
      if (listsArr?.length && !result.lists.length) result.lists = normalizeLists(listsArr, username);
      const lc = toNum(deepFind(json, ["lists_count", "list_count", "total_lists"]));
      if (lc !== null) result.listsCount = lc;
      if (result.listsCount === null && result.lists.length) result.listsCount = result.lists.length;
    } catch (e: any) {
      attempts.push({ url: url.replace("https://benable.com", ""), status: e?.name === "AbortError" ? "timeout" : "error" });
    }
  }

  // Fallback / pelengkap: halaman profil publik
  if (username && (result.listsCount === null || !result.lists.length)) {
    try {
      const url = `https://benable.com/${encodeURIComponent(username)}`;
      const r = await fetchText(url, { ...authHeaders });
      attempts.push({ url: `/${username}`, status: r.status });
      if (r.ok && r.text) {
        result.ok = true;
        result.source.push("profile-page");
        const parsed = parseProfileHtml(r.text, username);
        if (result.listsCount === null) result.listsCount = parsed.listsCount;
        if (!result.lists.length) result.lists = parsed.lists;
        if (result.followers === null) result.followers = parsed.followers;
        if (result.following === null) result.following = parsed.following;
      }
    } catch (e: any) {
      attempts.push({ url: `/${username}`, status: e?.name === "AbortError" ? "timeout" : "error" });
    }
  }

  result.attempts = attempts;
  if (!result.ok) {
    return NextResponse.json(
      { ...result, error: "Tidak bisa menghubungi Benable dari server. Coba lagi, atau cek apakah username benar." },
      { status: 200 }
    );
  }
  return NextResponse.json(result);
}
