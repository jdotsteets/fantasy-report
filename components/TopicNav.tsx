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
