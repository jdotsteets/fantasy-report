"use client";

import { useMemo, useState } from "react";

export type AttentionRow = {
  id: number;
  source: string;
  status: "ok" | "stale" | "cold" | "error" | string;
  articlesInWindow: number;
  totalArticles: number;
  lastDiscovered: string | null;
  lastStatus: number | null;   // last HTTP status, if any
  lastDetail: string | null;   // short error detail
  rss_url: string | null;
  homepage_url: string | null;
  allowed: boolean | null;
  category?: string | null;    // for "Hide team pages"
  suggestion?: string;         // short “what to fix” text
};

// same “team” detector you use in the sources table
const TEAM_RX = new RegExp(
  String.raw`\b(49ers|cardinals|falcons|ravens|bills|panthers|bears|bengals|browns|cowboys|broncos|lions|packers|texans|colts|jaguars|chiefs|raiders|chargers|rams|dolphins|vikings|patriots|saints|giants|jets|eagles|steelers|seahawks|buccaneers|bucs|titans|commanders)\b`,
  "i"
);
function looksLikeTeam(name: string, category?: string | null) {
  const c = (category ?? "").toLowerCase();
  if (c.includes("team")) return true; // "team", "team site", etc.
  return TEAM_RX.test(name);
}

export default function AttentionTable({ rows }: { rows: AttentionRow[] }) {
  const [q, setQ] = useState("");
  const [hideTeams, setHideTeams] = useState(true);
  const [sortKey, setSortKey] = useState<
    "source" | "status" | "inWindow" | "total" | "last"
  >("inWindow");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(k: typeof sortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();

    let out = rows.filter((r) => {
      if (hideTeams && looksLikeTeam(r.source, r.category)) return false;
      if (!needle) return true;
      return (
        r.source.toLowerCase().includes(needle) ||
        (r.homepage_url ?? "").toLowerCase().includes(needle) ||
        (r.rss_url ?? "").toLowerCase().includes(needle)
      );
    });

    out = out.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "source") return a.source.localeCompare(b.source) * dir;
      if (sortKey === "status") return String(a.status).localeCompare(String(b.status)) * dir;
      if (sortKey === "inWindow") return (a.articlesInWindow - b.articlesInWindow) * dir;
      if (sortKey === "total") return (a.totalArticles - b.totalArticles) * dir;

      // last discovered
      const ad = a.lastDiscovered ? Date.parse(a.lastDiscovered) : 0;
      const bd = b.lastDiscovered ? Date.parse(b.lastDiscovered) : 0;
      return (ad - bd) * dir;
    });

    return out;
  }, [rows, q, hideTeams, sortKey, sortDir]);

  function chip(status: AttentionRow["status"], code?: number | null) {
    const base = "rounded px-1.5 py-0.5 text-xs font-medium";
    if (status === "ok") return <span className={`${base} bg-emerald-100 text-emerald-800`}>ok</span>;
    if (status === "stale") return <span className={`${base} bg-amber-100 text-amber-900`}>stale</span>;
    if (status === "cold") return <span className={`${base} bg-zinc-200 text-zinc-800`}>cold</span>;
    if (typeof code === "number")
      return <span className={`${base} bg-rose-100 text-rose-800`}>http {code}</span>;
    return <span className={`${base} bg-rose-100 text-rose-800`}>error</span>;
  }

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-9 w-64 rounded border px-3 text-sm"
          placeholder="Search name / url…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex select-none items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hideTeams}
            onChange={(e) => setHideTeams(e.target.checked)}
          />
          Hide team pages
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[18%]" />
            <col className="w-[24%]" />
            <col className="w-[8%]" />
          </colgroup>

        <thead className="bg-zinc-50">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left whitespace-nowrap">
              <th className="cursor-pointer" onClick={() => toggleSort("source")}>
                source {sortKey === "source" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort("status")}>
                status {sortKey === "status" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort("inWindow")}>
                in window {sortKey === "inWindow" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort("total")}>
                total {sortKey === "total" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort("last")}>
                last seen {sortKey === "last" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th className="whitespace-nowrap">last error / hint</th>
              <th className="whitespace-nowrap">links</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t align-middle">
                <td className="px-3 py-2 whitespace-nowrap">
                  <a
                    href={`/admin/sources#source-${r.id}`}
                    className="text-emerald-700 underline"
                  >
                    {r.source}
                  </a>
                  {r.allowed === false ? (
                    <span className="ml-2 rounded bg-zinc-200 px-1.5 text-xs text-zinc-700">
                      disabled
                    </span>
                  ) : null}
                </td>

                <td className="px-3 py-2 whitespace-nowrap">
                  {chip(r.status, r.lastStatus)}
                </td>

                <td className="px-3 py-2 whitespace-nowrap">{r.articlesInWindow}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.totalArticles}</td>

                <td className="px-3 py-2 whitespace-nowrap">
                  {r.lastDiscovered ? new Date(r.lastDiscovered).toLocaleString() : "—"}
                </td>

                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="inline-block max-w-[360px] truncate align-middle text-zinc-600">
                    {r.lastDetail ?? ""}
                    {r.suggestion ? (
                      <span className="ml-2 text-xs text-zinc-500">— {r.suggestion}</span>
                    ) : null}
                  </span>
                </td>

                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex flex-nowrap items-center gap-2">
                    {r.homepage_url ? (
                      <a className="text-blue-700 underline" href={r.homepage_url} target="_blank" rel="noreferrer">
                        homepage
                      </a>
                    ) : null}
                    {r.rss_url ? (
                      <a className="text-blue-700 underline" href={r.rss_url} target="_blank" rel="noreferrer">
                        rss
                      </a>
                    ) : null}
                    <a className="text-blue-700 underline" href={`#source-${r.id}`}>
                      edit
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
