import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import Footer from "@/components/Footer";
import { VIDEO_CONFIG } from "@/lib/video-config";
import "./globals.css";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "900"], variable: "--font-poppins" });

export const metadata: Metadata = {
  title: `Videochiamate — ${VIDEO_CONFIG.brand}`,
  applicationName: VIDEO_CONFIG.brand,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#5A0E18",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={poppins.variable}>
      <body>
        <div className="app">
          <main className="main">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
