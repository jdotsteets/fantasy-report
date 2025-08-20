"use client";
import { useMemo } from "react";
import Link from "next/link";

const TOPICS = ["rankings","waiver-wire","start-sit","injury","trade","dfs","news"];

function currentNFLWeek(d = new Date()) {
  // super simple approximation: count weeks since Sept 1
  const seasonStart = new Date(d.getFullYear(), 8, 1); // Sept 1
  const diff = Math.max(0, Math.ceil((+d - +seasonStart) / (7*24*3600*1000)));
  return Math.min(Math.max(diff, 1), 22); // 1..22 (pre, wc, etc.)
}

export default function TopicNav() {

  const items = [
    { href: "/nfl/rankings", label: "rankings" },
    { href: "/nfl/waiver-wire", label: "waiver wire" },
    { href: "/nfl/start-sit", label: "start sit" },
    { href: "/nfl/injury", label: "injury" },
    { href: "/nfl/trade", label: "trade" },
    { href: "/nfl/dfs", label: "dfs" },
    { href: "/nfl/news", label: "news" },
  ];

  return (
    <nav className="my-4">
      <ul className="flex flex-wrap justify-center gap-2">
        {items.map((it) => (
          <li key={it.href}>
            <a
              href={it.href}
              className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );


  const week = useMemo(() => currentNFLWeek(), []);
  return (
    <nav className="flex flex-wrap gap-2 my-4">
      {TOPICS.map(t => (
        <Link
          key={t}
          href={`/nfl/week/${week}/${t}`}
          className="px-3 py-1 rounded-full border text-sm hover:bg-gray-50"
        >
          {t.replace("-", " ")}
        </Link>
      ))}
    </nav>
  );
}
