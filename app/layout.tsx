// app/layout.tsx
import "./globals.css";
import type { Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import TopToolbar from "@/components/TopToolbar";
import ImageToggle from "@/components/ImageToggle";
import SearchToggle from "@/components/HeaderSearch";
import { Analytics } from "@vercel/analytics/react";

// Use the shared metadata (must point to /og.jpg)
export { BASE_METADATA as metadata } from "./metadata-base";

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-white">
      <head>
        {/* Hardcode tags too (belt & suspenders) */}
        <meta property="og:image" content="https://thefantasyreport.com/og.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://thefantasyreport.com/og.jpg" />
      </head>
      <body className="min-h-full text-zinc-900 antialiased" style={{ ["--header-h" as unknown as string]: "56px" }}>
        {/* …your header / layout unchanged… */}
        <TopToolbar />
        <main id="main" className="mx-auto max-w-[100%] px-0 sm:px-4 lg:px-8 pt-2 pb-4">{children}</main>
        <footer className="border-t border-zinc-200">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 text-sm text-zinc-600">
            © {new Date().getFullYear()} Fantasy Football Aggregator · All links belong to their respective publishers
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
