import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cryptiga",
  description: "Crypto trading backtest UI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}
