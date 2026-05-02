import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "getirbakim.com — Yedek Parça Arama Platformu",
    template: "%s | getirbakim.com",
  },
  description:
    "Türkiye'nin yedek parça arama platformu. Birden fazla tedarikçiden anlık fiyat ve stok karşılaştırması. OEM numarası ile doğru parçayı bulun.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"
  ),
  openGraph: {
    type: "website",
    locale: "tr_TR",
    siteName: "getirbakim.com",
    title: "getirbakim.com — Yedek Parça Arama Platformu",
    description:
      "Türkiye'nin yedek parça arama platformu. Birden fazla tedarikçiden anlık fiyat ve stok karşılaştırması.",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}