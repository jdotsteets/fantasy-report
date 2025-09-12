// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import TopToolbar from "@/components/TopToolbar";
import { Search as SearchIcon } from "lucide-react"; // NEW
import ImageToggle from "@/components/ImageToggle";
import SearchToggle from "@/components/HeaderSearch";


export const metadata: Metadata = {
  title: "The Fantasy Report",
  description: "The best free fantasy football links organized for you.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-white">
      {/* Expose a smaller header height so the toolbar can stick right below it */}
      <body
        className="min-h-full text-zinc-900 antialiased"
        style={{ ["--header-h" as any]: "56px" }}   // was ~64px before
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-zinc-100 focus:px-3 focus:py-2"
        >
          Skip to content
        </a>

        {/* Top bar / header — tighter paddings */}
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-black/95 backdrop-blur">
          <div className="relative mx-auto max-w-[100%] px-3 sm:px-4 lg:px-6 py-2">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-black"
            />
            <div className="relative z-10 flex items-center justify-between gap-2">
              <Link href="/" className="flex items-center gap-2 sm:gap-3">
                <Image
                  src="/logo.png"
                  alt="The Fantasy Report"
                  width={40}   // was 45
                  height={40}
                  priority
                />
                <p className="hidden md:block font-sans text-[11px] sm:text-[12px] leading-tight text-white">
                  News, Updates, Rankings, and Advice from the experts.
                </p>
                <span className="sr-only">The Fantasy Report</span>
              </Link>

              {/* Icon-only Search button */}
              <div className="flex items-center gap-2">
<div className="flex items-center gap-2">
  <SearchToggle />
</div>
                          <ImageToggle />
              </div>

            </div>
          </div>
        </header>

        {/* Section toolbar (sticks under the header) */}
        <TopToolbar />

        {/* Page content */}
        <main id="main" className="mx-auto max-w-[100%] px-0 sm:px-4 lg:px-8 pt-2 pb-4">
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
