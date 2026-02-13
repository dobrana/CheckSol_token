import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Check Solana token — creator story & risk",
  description:
    "Check Solana token: we analyze the creator’s story, risk score and red flags before you invest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans">{children}</body>
    </html>
  );
}
