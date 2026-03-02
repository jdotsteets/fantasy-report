"use client";

import Link from "next/link";

const TOPIC_ITEMS = [
  { href: "/nfl/rankings", label: "Rankings" },
  { href: "/nfl/waiver-wire", label: "Waiver Wire" },
  { href: "/nfl/start-sit", label: "Start Sit" },
  { href: "/nfl/injury", label: "Injury" },
  { href: "/nfl/trade", label: "Trade" },
  { href: "/nfl/dfs", label: "DFS" },
  { href: "/nfl/news", label: "News" },
  { href: "/nfl/advice", label: "Advice" },
];

export default function TopicNav() {
  return (
    <nav className="my-4">
      <ul className="flex flex-wrap justify-center gap-2">
        {TOPIC_ITEMS.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-700 hover:border-green-800 hover:bg-green-50 hover:text-green-800"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
