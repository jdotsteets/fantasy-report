"use client";

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

export default function TopicNav() {
  return (
    <nav className="my-4">
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
    </nav>
  );
}
