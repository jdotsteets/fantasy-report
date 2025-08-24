// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import HeaderSearch from "@/components/HeaderSearch";
import ImageToggle from "@/components/ImageToggle";
import Image from "next/image";      // ← add
import Link from "next/link";        // ← add

export const metadata: Metadata = {
  title: "The Fantasy Report",
  description: "The best free fantasy football links organized for you.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

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
            {/* subtle emerald wash like Section headers */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-b-xl
                         bg-gradient-to-b from-emerald-900/0 to-emerald-800/0
                         shadow-[inset_0_-1px_0_rgba(6,95,70,0.06)]"
            />

            <div className="relative z-10 flex items-center justify-between gap-3">
              {/* Left: icon + tagline */}
              <Link href="/" className="flex items-center gap-2 sm:gap-3">
                <Image
                  src="/logo.png"                 // <- your icon in /public
                  alt="The Fantasy Report"
                  width={45}
                  height={45}
                  priority
                  className=""
                />
                <p className="hidden md:block font-sans text-[12px] sm:text-sm leading-tight text-black">
                  News, Updates, Rankings, and Advice from the experts.
                </p>
                <span className="sr-only">The Fantasy Report</span>
              </Link>

              {/* Right-side actions */}
              <div className="flex items-center gap-2 sm:gap-3">
                <HeaderSearch />
                <ImageToggle />
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main id="main" className="mx-auto max-w-[100%] px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-zinc-200">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 text-sm text-zinc-600">
            © {new Date().getFullYear()} Fantasy Football Aggregator · All links belong to their respective publishers
          </div>
        </footer>
      </body>
    </html>
  );
}
