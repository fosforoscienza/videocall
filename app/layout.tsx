import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { VIDEO_CONFIG } from "@/lib/video-config";
import "./globals.css";

// Figtree, il font del sito fosforo: (SIL Open Font License, app/fonts/OFL-figtree.txt)
const figtree = localFont({ src: "./fonts/figtree-normal.woff2", weight: "300 900", variable: "--font-main", display: "swap" });

export const metadata: Metadata = {
  title: `Videochiamate | ${VIDEO_CONFIG.brand}`,
  applicationName: VIDEO_CONFIG.brand,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0b2233",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={figtree.variable}>
      <body>
        <div className="app">
          <Header />
          <main className="main">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
