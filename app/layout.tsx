// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Fantasy Football Aggregator",
  description: "The best free fantasy football links organized for you.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export const viewport: Viewport = {
  themeColor: "#ffffff", // white
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-white">
      <body className="min-h-full text-black antialiased">
        {/* Skip link for keyboard users */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-black focus:text-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>

        {/* Top bar / header */}
        <header className="border-b border-zinc-200">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-4">
            <h1 className="text-xl font-semibold tracking-tight">
              Fantasy Football Aggregator
            </h1>
          </div>
        </header>

        {/* Page content */}
        <main
          id="main"
          className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6"
        >
          {/* Center nav pills container */}
          <div className="mb-6 flex justify-center">
            {/* TopicNav should be wrapped in a <div className="flex justify-center"> 
                wherever you include it (layout or page). 
                If it's inside children already, you can remove this wrapper. */}
          </div>

          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-zinc-200">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 text-sm text-zinc-600">
            © {new Date().getFullYear()} Fantasy Football Aggregator · All links
            belong to their respective publishers
          </div>
        </footer>
      </body>
    </html>
  );
}
