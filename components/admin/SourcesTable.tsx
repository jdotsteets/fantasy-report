"use client";

import { useEffect, useMemo, useState } from "react";

type SourceRow = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  favicon_url: string | null;
  scrape_path: string | null;
  scrape_selector?: string | null;
  scraper_key?: string | null;
  fetch_mode?: "auto" | "rss" | "adapter" | null;
  adapter_config?: Record<string, unknown> | null;
  category?: string | null; // used by the “hide team pages” filter
  allowed?: boolean | null;
  priority?: number | null;
};

type ApiListResponse = SourceRow[];

export default function SourcesTable() {
  const [rows, setRows] = useState<ApiListResponse>([]);
  const [loading, setLoading] = useState(true);

  // toolbar state
  const [q, setQ] = useState("");
  const [hideTeams, setHideTeams] = useState(true);
  const [sortKey, setSortKey] = useState<"name" | "method" | "id">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/sources", { cache: "no-store" });
        const json = (await res.json()) as ApiListResponse;
        setRows(json);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // quick method classifier
  function methodOf(r: SourceRow): string {
    if (r.fetch_mode === "rss") return "RSS";
    if (r.fetch_mode === "adapter" || r.scraper_key) {
      return `Adapter${r.scraper_key ? ` (${r.scraper_key})` : ""}`;
    }
    if (r.scrape_selector) return "Scrape";
    return "Auto";
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();

    let out = rows.filter((r) => {
      // STRICT team filter: category === 'team' (case-insensitive)
      if (hideTeams && (r.category ?? "").toLowerCase() === "team") return false;

      if (!needle) return true;
      return (
        (r.name ?? "").toLowerCase().includes(needle) ||
        (r.homepage_url ?? "").toLowerCase().includes(needle) ||
        (r.rss_url ?? "").toLowerCase().includes(needle) ||
        (r.scraper_key ?? "").toLowerCase().includes(needle)
      );
    });

    out = out.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "id") return (a.id - b.id) * dir;
      if (sortKey === "method") return methodOf(a).localeCompare(methodOf(b)) * dir;
      return (a.name ?? "").localeCompare(b.name ?? "") * dir;
    });

    return out;
  }, [rows, q, hideTeams, sortKey, sortDir]);

  function toggleSort(k: "name" | "method" | "id") {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  // util: open the editor panel and focus the chosen id
  function openEditor(id: number) {
    window.dispatchEvent(new CustomEvent("source:open", { detail: { id } }));
    window.location.hash = `source-${id}`;
  }

  // small helper to display adapter_config compactly on one line
  function compactConfig(c: SourceRow["adapter_config"]): string {
    if (!c || Object.keys(c).length === 0) return "{}";
    try {
      const s = JSON.stringify(c);
      // limit length to keep table tidy
      return s.length > 24 ? s.slice(0, 24) + "…" : s;
    } catch {
      return "{}";
    }
  }

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-9 w-64 rounded border px-3 text-sm"
          placeholder="Search name / url / key…"
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
        {loading ? (
          <div className="p-3 text-sm text-zinc-600">Loading…</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th className="cursor-pointer whitespace-nowrap" onClick={() => toggleSort("id")}>
                  id {sortKey === "id" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="cursor-pointer whitespace-nowrap" onClick={() => toggleSort("name")}>
                  name {sortKey === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="cursor-pointer whitespace-nowrap" onClick={() => toggleSort("method")}>
                  method {sortKey === "method" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="whitespace-nowrap">homepage</th>
                <th className="whitespace-nowrap">rss</th>
                <th className="whitespace-nowrap">adapter config</th>
                <th className="whitespace-nowrap">test</th>
                <th className="whitespace-nowrap">last 10</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{methodOf(r)}</td>

                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.homepage_url ? (
                      <a className="text-blue-700 underline" href={r.homepage_url} target="_blank" rel="noreferrer">
                        homepage
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.rss_url ? (
                      <a className="text-blue-700 underline" href={r.rss_url} target="_blank" rel="noreferrer">
                        rss
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>

                  {/* keep everything on a single line via inline-flex + whitespace-nowrap */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <button
                        className="rounded border px-2 py-0.5 text-xs hover:bg-zinc-50"
                        onClick={() => openEditor(r.id)}
                        title="Open editor"
                      >
                        Edit
                      </button>

                      <button
                        className="rounded border px-2 py-0.5 text-xs hover:bg-zinc-50"
                        onClick={() => openEditor(r.id)}
                        title="Edit adapter_config in the editor panel"
                      >
                        Config
                      </button>

                      <span className="rounded bg-zinc-100 px-1.5 font-mono text-xs text-zinc-700">
                        {compactConfig(r.adapter_config)}
                      </span>
                    </span>
                  </td>

                  {/* keep single-line by sending actions to a new tab */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <a
                      className="rounded border px-2 py-0.5 text-xs hover:bg-zinc-50"
                      href={`/api/admin/ingest?sourceId=${r.id}&limit=50&includeHealth=1`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Test
                    </a>
                  </td>

                  <td className="px-3 py-2 whitespace-nowrap">
                    <a
                      className="rounded border px-2 py-0.5 text-xs hover:bg-zinc-50"
                      href={`/api/admin/sources/recent?sourceId=${r.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Show last 10
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
