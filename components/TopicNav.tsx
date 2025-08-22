"use client";

import { useMemo } from "react";
import Link from "next/link";

const TOPIC_ITEMS = [
  { href: "/nfl/rankings", label: "rankings" },
  { href: "/nfl/waiver-wire", label: "waiver wire" },
  { href: "/nfl/start-sit", label: "start sit" },
  { href: "/nfl/injury", label: "injury" },
  { href: "/nfl/trade", label: "trade" },
  { href: "/nfl/dfs", label: "dfs" },
  { href: "/nfl/news", label: "news" },
  { href: "/nfl/advice", label: "advice" },
];

// quick-and-simple current week (Sept 1 → Week 1)
function currentNFLWeek(d = new Date()): number {
  const seasonStart = new Date(d.getFullYear(), 8, 1); // Sept 1 (local time)
  const diffWeeks = Math.max(0, Math.ceil((+d - +seasonStart) / (7 * 24 * 3600 * 1000)));
  return Math.min(Math.max(diffWeeks, 1), 22);
}

const WEEK_TOPICS = ["rankings", "waiver-wire", "start-sit", "injury", "dfs", "advice"];

export default function TopicNav() {
  const week = useMemo(() => currentNFLWeek(), []);

  return (
    <nav className="my-4 space-y-2">
      {/* Row 1: global topics */}
      <ul className="flex flex-wrap justify-center gap-2">
        {TOPIC_ITEMS.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-700 hover:border-green-300 hover:bg-green-50 hover:text-green-800"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>

      {/* Row 2: quick links for the current week */}
      <ul className="flex flex-wrap justify-center gap-2">
        {WEEK_TOPICS.map((t) => (
          <li key={t}>
            <Link
              href={`/nfl/week/${week}/${t}`}
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 hover:border-green-300 hover:bg-green-50 hover:text-green-800"
            >
              week {week}: {t.replace("-", " ")}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
