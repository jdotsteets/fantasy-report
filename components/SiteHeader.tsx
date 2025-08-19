// components/SiteHeader.tsx
"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

const TOPIC_LABELS: Record<string, string> = {
  news: "News",
  "waiver-wire": "Waiver Wire",
  rankings: "Rankings",
  "start-sit": "Start/Sit",
  injury: "Injuries",
  dfs: "DFS",
};

export default function SiteHeader() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);

  const week = sp.get("week") || "";

  return (
    <header className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur border-b border-zinc-800">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Fantasy Report
        </Link>

        {/* Week quick-tabs (1..18) — compact on md+ */}
        <nav className="hidden md:flex items-center gap-2 ml-auto">
          {Array.from({ length: 18 }, (_, i) => `${i + 1}`).map((w) => {
            const href = w === week ? "/" : `/?week=${w}`;
            const active = w === week;
            return (
              <Link
                key={w}
                href={href}
                className={`rounded px-2 py-1 text-sm hover:bg-zinc-800 ${active ? "bg-zinc-800" : "bg-transparent"}`}
              >
                W{w}
              </Link>
            );
          })}
        </nav>

        {/* Topics menu (mobile/desktop) */}
        <div className="relative">
          <button
            className="rounded border border-zinc-800 px-3 py-1 text-sm hover:bg-zinc-800"
            onClick={() => setOpen((v) => !v)}
          >
            Topics
          </button>
          {open && (
            <div
              className="absolute right-0 mt-2 w-56 rounded border border-zinc-800 bg-zinc-900/95 p-1 text-sm"
              onMouseLeave={() => setOpen(false)}
            >
              {Object.entries(TOPIC_LABELS).map(([k, v]) => (
                <Link
                  key={k}
                  href={`/nfl/${k}${week ? `?week=${week}` : ""}`}
                  className="block rounded px-3 py-2 hover:bg-zinc-800"
                >
                  {v}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
