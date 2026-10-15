import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beben — Benable Account Monitor",
  description: "Pantau perkembangan akun Benable: profil, jumlah list, dan cashback.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
