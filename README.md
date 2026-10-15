# Beben — Benable Account Monitor

Website untuk memantau perkembangan akun Benable: **nama profil, jumlah list, cashback, cashback pending, dan followers** — untuk satu atau banyak akun sekaligus.

## Fitur
- Tambah akun dengan menempel **export cookie Benable** (JSON dari ekstensi Cookie-Editor) — nama profil, avatar, email, dan cashback langsung terbaca dari cookie `current_user`.
- Mode username saja untuk pantau profil publik (tanpa cashback).
- **Refresh real-time**: server aplikasi (`/api/account`) mengambil data terbaru dari benable.com menggunakan cookie/token akunmu, mencoba beberapa endpoint API Benable + halaman profil publik, lalu menormalisasi hasilnya.
- **Riwayat perkembangan**: setiap refresh menyimpan snapshot (jumlah list, cashback, pending, followers) di browser, lengkap dengan grafik mini, tabel riwayat, dan perubahan cashback antar-snapshot.
- Ringkasan total semua akun + **Export CSV**.
- Multi-akun.

## Keamanan
- Cookie **tidak** ditulis ke kode, Git, atau database. Cookie hanya tersimpan di `localStorage` browser pengguna dan diteruskan ke `benable.com` saat refresh.
- Jangan commit file cookie. `.gitignore` sudah memblokir pola `*cookie*.json`.
- Jangan bagikan cookie akun ke siapa pun — cookie setara kunci login.

## Menjalankan lokal
```bash
npm install
npm run dev
# buka http://localhost:3000
```

## Deploy ke Vercel
1. Push repo ini ke GitHub.
2. Di [vercel.com](https://vercel.com) → **Add New → Project** → import repo ini.
3. Framework Preset: **Next.js** (terdeteksi otomatis). Tidak perlu Environment Variable apa pun.
4. **Deploy**. Selesai — aplikasi langsung online.

Atau lewat CLI:
```bash
npm i -g vercel
vercel --prod
```

## Catatan
Benable tidak menyediakan API publik resmi, jadi pengambilan data memakai cookie login milikmu sendiri dan/atau halaman profil publik. Jika Benable mengubah struktur API/halamannya, sesuaikan daftar endpoint & parser di `app/api/account/route.ts`.
