"use client";
import { useEffect, useMemo, useState } from "react";

type Snapshot = { at: string; lists: number | null; cashback: number | null; pending: number | null; followers: number | null };
type BenableList = { title: string; url?: string; items: number | null; cover?: string | null };
type Account = {
  id: string; name: string; username: string; userId?: number | string; avatarUrl?: string; bio?: string;
  email?: string; joinDate?: string; profileUrl: string; apiToken?: string; cookieHeader?: string;
  listsCount: number | null; lists: BenableList[]; cashback: number | null; pendingCashback: number | null;
  followers: number | null; following: number | null;
  status: "ok" | "partial" | "error"; statusMsg?: string; lastChecked?: string; source?: string[];
  history: Snapshot[];
};

const LS_KEY = "beben-benable-accounts-v1";
const money = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`);
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("id-ID"));
const timeID = (iso?: string) => (iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "Belum pernah");

/* ---------- Parsing cookie di browser (tidak dikirim ke mana pun selain /api/account milik sendiri) ---------- */
function parseCookieInput(raw: string): { user: any; cookieHeader: string } {
  const text = raw.trim();
  if (!text) throw new Error("Tempel cookie dulu ya.");
  // Format 1: JSON export Cookie-Editor (array)
  if (text.startsWith("[")) {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error("Format JSON cookie tidak dikenal.");
    const header = arr.filter((c: any) => c?.name).map((c: any) => `${c.name}=${c.value}`).join("; ");
    const cu = arr.find((c: any) => c.name === "current_user");
    if (!cu) throw new Error("Cookie `current_user` tidak ditemukan. Pastikan export cookie dari benable.com saat sudah login.");
    return { user: JSON.parse(decodeURIComponent(cu.value)), cookieHeader: header };
  }
  // Format 2: Cookie header string / potongan current_user=...
  const m = text.match(/current_user=([^;]+)/);
  if (m) return { user: JSON.parse(decodeURIComponent(m[1])), cookieHeader: text.includes("=") && text.includes(";") ? text : `current_user=${m[1]}` };
  // Format 3: JSON current_user langsung
  if (text.startsWith("{")) {
    const user = JSON.parse(text);
    if (user?.username) return { user, cookieHeader: "" };
  }
  throw new Error("Format tidak dikenal. Tempel export JSON dari Cookie-Editor, atau string cookie yang berisi current_user=...");
}

function accountFromUser(user: any, cookieHeader: string): Account {
  const cb = user?.cashback || {};
  return {
    id: String(user.id ?? user.username),
    name: user.name || user.username || "Akun Benable",
    username: user.username || "",
    userId: user.id,
    avatarUrl: user.avatar_url,
    bio: user.bio || "",
    email: user.email,
    joinDate: user.join_date,
    profileUrl: user.profile_url || (user.username ? `https://benable.com/${user.username}` : "https://benable.com"),
    apiToken: user.api_token,
    cookieHeader: cookieHeader || undefined,
    listsCount: null,
    lists: [],
    cashback: cb.amount_in_cents != null ? cb.amount_in_cents / 100 : null,
    pendingCashback: cb.pending_amount_in_cents != null ? cb.pending_amount_in_cents / 100 : null,
    followers: Array.isArray(user.follower_ids) ? user.follower_ids.length : null,
    following: Array.isArray(user.following_ids) ? user.following_ids.length : null,
    status: "partial",
    statusMsg: "Dari cookie — klik Refresh untuk ambil jumlah list terbaru",
    history: [],
  };
}

/* ---------- Grafik mini (SVG, tanpa library) ---------- */
function Sparkline({ data, color }: { data: (number | null)[]; color: string }) {
  const vals = data.filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length < 2) return <span className="note">Butuh ≥2× refresh untuk grafik</span>;
  const w = 260, h = 64, pad = 6;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${pad + (i / (vals.length - 1)) * (w - pad * 2)},${h - pad - ((v - min) / span) * (h - pad * 2)}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Grafik perkembangan">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function Home() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [cookieText, setCookieText] = useState("");
  const [manualUsername, setManualUsername] = useState("");
  const [addError, setAddError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [metric, setMetric] = useState<"cashback" | "lists">("cashback");

  useEffect(() => {
    try { setAccounts(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); } catch { /* abaikan */ }
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) localStorage.setItem(LS_KEY, JSON.stringify(accounts)); }, [accounts, loaded]);
  useEffect(() => { if (!selected && accounts[0]) setSelected(accounts[0].id); }, [accounts, selected]);

  const totals = useMemo(() => ({
    lists: accounts.reduce((s, a) => s + (a.listsCount ?? 0), 0),
    cashback: accounts.reduce((s, a) => s + (a.cashback ?? 0), 0),
    pending: accounts.reduce((s, a) => s + (a.pendingCashback ?? 0), 0),
  }), [accounts]);

  const sel = accounts.find((a) => a.id === selected);

  async function refresh(acc: Account) {
    setBusyId(acc.id);
    try {
      const res = await fetch("/api/account", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: acc.username, userId: acc.userId, apiToken: acc.apiToken, cookieHeader: acc.cookieHeader }),
      });
      const data = await res.json();
      const now = new Date().toISOString();
      setAccounts((prev) => prev.map((a) => {
        if (a.id !== acc.id) return a;
        const next: Account = {
          ...a,
          name: data.name || a.name,
          avatarUrl: data.avatarUrl || a.avatarUrl,
          listsCount: data.listsCount ?? a.listsCount,
          lists: data.lists?.length ? data.lists : a.lists,
          cashback: data.cashback ?? a.cashback,
          pendingCashback: data.pendingCashback ?? a.pendingCashback,
          followers: data.followers ?? a.followers,
          following: data.following ?? a.following,
          status: data.ok ? (data.listsCount !== null && data.listsCount !== undefined ? "ok" : "partial") : "error",
          statusMsg: data.ok ? `Sumber: ${(data.source || []).join(", ") || "-"}` : (data.error || "Gagal mengambil data"),
          source: data.source, lastChecked: now,
        };
        next.history = [...(a.history || []), { at: now, lists: next.listsCount, cashback: next.cashback, pending: next.pendingCashback, followers: next.followers }].slice(-90);
        return next;
      }));
    } catch {
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? { ...a, status: "error", statusMsg: "Gagal menghubungi server aplikasi." } : a)));
    } finally { setBusyId(null); }
  }

  async function refreshAll() { for (const a of accounts) await refresh(a); }

  function addAccount() {
    setAddError("");
    try {
      let acc: Account;
      if (cookieText.trim()) {
        const { user, cookieHeader } = parseCookieInput(cookieText);
        acc = accountFromUser(user, cookieHeader);
      } else if (manualUsername.trim()) {
        const u = manualUsername.replace(/^@/, "").trim();
        acc = { id: u, name: u, username: u, profileUrl: `https://benable.com/${u}`, listsCount: null, lists: [], cashback: null, pendingCashback: null, followers: null, following: null, status: "partial", statusMsg: "Mode username saja — cashback butuh cookie", history: [] };
      } else throw new Error("Isi cookie, atau minimal username Benable.");
      setAccounts((prev) => {
        const exists = prev.find((p) => p.id === acc.id);
        if (exists) return prev.map((p) => (p.id === acc.id ? { ...acc, history: exists.history, lists: exists.lists, listsCount: exists.listsCount, lastChecked: exists.lastChecked } : p));
        return [...prev, acc];
      });
      setSelected(acc.id); setCookieText(""); setManualUsername(""); setShowAdd(false);
      setTimeout(() => refresh(acc), 50);
    } catch (e: any) { setAddError(e?.message || "Gagal membaca cookie."); }
  }

  function remove(id: string) {
    if (!confirm("Hapus akun ini dari pantauan? (Hanya dari browser ini, bukan dari Benable)")) return;
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  function exportCsv() {
    const rows = [["waktu", "akun", "username", "jumlah_list", "cashback_usd", "pending_usd", "followers"]];
    for (const a of accounts) for (const h of a.history) rows.push([h.at, a.name, a.username, String(h.lists ?? ""), String(h.cashback ?? ""), String(h.pending ?? ""), String(h.followers ?? "")]);
    if (rows.length === 1) for (const a of accounts) rows.push([a.lastChecked || "", a.name, a.username, String(a.listsCount ?? ""), String(a.cashback ?? ""), String(a.pendingCashback ?? ""), String(a.followers ?? "")]);
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "benable-monitor.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="logo">
          <div className="logo-badge">B</div>
          <div>
            <h1>Beben — Benable Monitor</h1>
            <div className="sub">Pantau nama profil, jumlah list &amp; cashback akun Benable kamu. Data diambil langsung saat Refresh.</div>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={exportCsv} disabled={!accounts.length}>⬇ Export CSV</button>
          <button className="btn" onClick={refreshAll} disabled={!accounts.length || busyId !== null}>🔄 Refresh Semua</button>
          <button className="btn primary" onClick={() => setShowAdd(true)}>+ Tambah Akun</button>
        </div>
      </header>

      <section className="cards">
        <div className="stat"><div className="label">Akun Dipantau</div><div className="value">{accounts.length}</div><div className="hint">Tersimpan hanya di browser ini</div></div>
        <div className="stat"><div className="label">Total List</div><div className="value">{num(totals.lists)}</div><div className="hint">Dari refresh terakhir semua akun</div></div>
        <div className="stat"><div className="label">Total Cashback</div><div className="value">{money(totals.cashback)}</div><div className="hint">Saldo cashback tersedia</div></div>
        <div className="stat"><div className="label">Cashback Pending</div><div className="value">{money(totals.pending)}</div><div className="hint">Masih menunggu / belum cair</div></div>
      </section>

      <section className="panel">
        <h2>Akun Benable</h2>
        {!accounts.length ? (
          <div className="empty">
            <p style={{ fontSize: 34, margin: "0 0 8px" }}>👀</p>
            Belum ada akun. Klik <b>+ Tambah Akun</b>, lalu tempel export cookie Benable kamu<br />(dari ekstensi Cookie-Editor saat login di benable.com).
          </div>
        ) : (
          <div className="tablewrap"><table>
            <thead><tr><th>Profil</th><th>Jumlah List</th><th>Cashback</th><th>Pending</th><th>Followers</th><th>Status</th><th>Terakhir Dicek</th><th></th></tr></thead>
            <tbody>{accounts.map((a) => (
              <tr key={a.id} onClick={() => setSelected(a.id)} style={{ cursor: "pointer", background: sel?.id === a.id ? "#faf7ff" : undefined }}>
                <td><div className="usercell">
                  {a.avatarUrl ? <img className="avatar" src={a.avatarUrl} alt="" /> : <span className="avatar-fallback">{(a.name || "?").slice(0, 1)}</span>}
                  <div><b>{a.name}</b><div className="note">@{a.username} · <a href={a.profileUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>buka profil ↗</a></div></div>
                </div></td>
                <td><b style={{ fontSize: 17 }}>{num(a.listsCount)}</b></td>
                <td><b>{money(a.cashback)}</b></td>
                <td>{money(a.pendingCashback)}</td>
                <td>{num(a.followers)}</td>
                <td><span className={`pill ${a.status === "ok" ? "ok" : a.status === "error" ? "bad" : "warn"}`}>{a.status === "ok" ? "Terhubung" : a.status === "error" ? "Gagal" : "Sebagian"}</span><div className="note" style={{ maxWidth: 230 }}>{a.statusMsg}</div></td>
                <td className="note">{timeID(a.lastChecked)}</td>
                <td><div className="row" style={{ flexWrap: "nowrap" }}>
                  <button className="btn small" disabled={busyId === a.id} onClick={(e) => { e.stopPropagation(); refresh(a); }}>{busyId === a.id ? "Memuat…" : "🔄 Refresh"}</button>
                  <button className="btn small danger" onClick={(e) => { e.stopPropagation(); remove(a.id); }}>Hapus</button>
                </div></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </section>

      {sel && (
        <section className="panel">
          <div className="row"><h2 className="grow" style={{ margin: 0 }}>Perkembangan — {sel.name}</h2>
            <select value={metric} onChange={(e) => setMetric(e.target.value as any)}>
              <option value="cashback">Cashback ($)</option><option value="lists">Jumlah List</option>
            </select></div>
          <p className="note">Setiap klik Refresh menyimpan snapshot baru. Grafik &amp; riwayat di bawah ini adalah catatan perkembangan nyata dari waktu ke waktu (tersimpan di browser ini).</p>
          <Sparkline data={sel.history.map((h) => (metric === "cashback" ? h.cashback : h.lists))} color={metric === "cashback" ? "#0f9d58" : "#7c3aed"} />
          {sel.lists.length > 0 && (<><h3 style={{ margin: "18px 0 4px", fontSize: 15 }}>List Terbaru ({sel.lists.length})</h3>
            <div className="listchips">{sel.lists.slice(0, 30).map((l, i) => (
              <span className="chip" key={i}>{l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.title}</a> : l.title}{l.items !== null ? ` · ${l.items} item` : ""}</span>))}
            </div></>)}
          {sel.history.length > 0 && (<div className="tablewrap" style={{ marginTop: 16 }}><table>
            <thead><tr><th>Waktu Snapshot</th><th>Jumlah List</th><th>Cashback</th><th>Pending</th><th>Followers</th><th>Perubahan Cashback</th></tr></thead>
            <tbody>{[...sel.history].reverse().slice(0, 20).map((h, i, arr) => {
              const prev = arr[i + 1]; const diff = h.cashback !== null && prev?.cashback != null ? h.cashback - prev.cashback : null;
              return <tr key={h.at + i}><td>{timeID(h.at)}</td><td>{num(h.lists)}</td><td>{money(h.cashback)}</td><td>{money(h.pending)}</td><td>{num(h.followers)}</td>
                <td>{diff === null ? "—" : <span style={{ color: diff > 0 ? "var(--ok)" : diff < 0 ? "var(--bad)" : undefined, fontWeight: 700 }}>{diff > 0 ? "+" : ""}{diff.toFixed(2)}</span>}</td></tr>;
            })}</tbody></table></div>)}
        </section>
      )}

      <section className="panel">
        <h2>Cara Pakai</h2>
        <ol className="note" style={{ lineHeight: 1.9, paddingLeft: 20 }}>
          <li>Login ke <b>benable.com</b> di Chrome, pasang ekstensi <b>Cookie-Editor</b>, lalu <b>Export → JSON</b>.</li>
          <li>Klik <b>+ Tambah Akun</b> di atas dan tempel hasilnya. Nama profil, avatar, email &amp; cashback langsung terbaca dari cookie <span className="mono">current_user</span>.</li>
          <li>Klik <b>🔄 Refresh</b> — server aplikasi mengambil jumlah list &amp; data terbaru dari Benable, lalu menyimpan snapshot riwayat.</li>
          <li>Bisa tambah banyak akun (multi-akun), pantau totalnya di kartu ringkasan, dan export ke CSV kapan saja.</li>
        </ol>
        <div className="warnbox">🔒 <b>Keamanan:</b> cookie = kunci login akunmu. Di aplikasi ini cookie hanya tersimpan di <b>localStorage browser kamu sendiri</b>, tidak masuk kode/Git dan tidak disimpan di server. Jangan pernah membagikan cookie ke orang lain / grup publik — siapa pun yang memegangnya bisa masuk akunmu. Kalau cookie ini sudah tersebar, segera logout dari semua perangkat &amp; ganti password Benable kamu.</div>
      </section>

      {showAdd && (
        <div className="modal-bg" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Tambah Akun Benable</h2>
            <p className="note">Tempel export cookie (disarankan), atau isi username saja untuk mode pantau publik (tanpa cashback).</p>
            <label className="f">Cookie Benable (JSON Cookie-Editor / string cookie)</label>
            <textarea value={cookieText} onChange={(e) => setCookieText(e.target.value)} placeholder='[{"domain":"benable.com","name":"current_user","value":"..."}, ...]' />
            <label className="f">…atau Username saja (opsional)</label>
            <input type="text" value={manualUsername} onChange={(e) => setManualUsername(e.target.value)} placeholder="contoh: usernamekamu" />
            {addError && <div className="err">{addError}</div>}
            <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setShowAdd(false)}>Batal</button>
              <button className="btn primary" onClick={addAccount}>Simpan &amp; Ambil Data</button>
            </div>
            <p className="note" style={{ marginTop: 12 }}>Cookie hanya disimpan di browser ini (localStorage) dan diteruskan ke benable.com lewat server aplikasi saat kamu klik Refresh.</p>
          </div>
        </div>
      )}
    </div>
  );
}
