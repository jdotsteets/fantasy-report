// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import HeaderSearch from "@/components/HeaderSearch";
import Image from "next/image";
import Link from "next/link";
import TopToolbar from "@/components/TopToolbar";

export const metadata: Metadata = {
  title: "The Fantasy Report",
  description: "The best free fantasy football links organized for you.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-white">
      <body className="min-h-full text-zinc-900 antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-zinc-100 focus:px-3 focus:py-2"
        >
          Skip to content
        </a>

        {/* Top bar / header */}
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
          <div className="relative mx-auto max-w-[100%] px-4 sm:px-6 lg:px-8 py-3">
            {/* 🔴 red wash instead of emerald */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-black shadow-[inset_0_-1px_0_rgba(220,38,38,0.25)]"
            />
            <div className="relative z-10 flex items-center justify-between gap-3">
              <Link href="/" className="flex items-center gap-2 sm:gap-3">
                <Image
                  src="/logo.png"
                  alt="The Fantasy Report"
                  width={45}
                  height={45}
                  priority
                />
                <p className="hidden md:block font-sans text-[12px] sm:text-sm leading-tight text-white">
                  News, Updates, Rankings, and Advice from the experts.
                </p>
                <span className="sr-only">The Fantasy Report</span>
              </Link>
              <div className="flex items-center gap-2 sm:gap-3">
                <HeaderSearch />
              </div>
            </div>
          </div>
        </header>

        {/* Toolbar can keep its own padding */}
        <TopToolbar />

        {/* Page content — remove outer gutters so pages/sections control spacing */}
        <main id="main" className="mx-auto max-w-[100%] px-0 sm:px-0 lg:px-0 pt-2 pb-6">
          {children}
        </main>

        <footer className="border-t border-zinc-200">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 text-sm text-zinc-600">
            © {new Date().getFullYear()} Fantasy Football Aggregator · All links belong to their respective publishers
          </div>
        </footer>
      </body>
    </html>
  );
}
