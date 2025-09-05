"use client";

import { useEffect, useMemo, useState } from "react";

/* ───────────────────────── Types ───────────────────────── */

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
  category?: string | null;
  allowed?: boolean | null;
  priority?: number | null;
};

type RecentItem = {
  title: string | null;
  url: string | null;
  discovered_at: string | null;
  published_at?: string | null;
};

/* ───────────────────────── Utils ───────────────────────── */

function normalizeList(payload: unknown): SourceRow[] {
  if (Array.isArray(payload)) return payload as SourceRow[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.rows)) return obj.rows as SourceRow[];
    if (Array.isArray(obj.items)) return obj.items as SourceRow[];
    if (Array.isArray(obj.sources)) return obj.sources as SourceRow[];
    if (obj.ok === false) return [];
    const values = Object.values(obj);
    if (values.length && values.every((v) => v && typeof v === "object" && (v as any).id != null)) {
      return values as SourceRow[];
    }
  }
  return [];
}

function normalizeRecent(payload: unknown): RecentItem[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const arr =
    (Array.isArray(obj.items) ? obj.items :
     Array.isArray(obj.rows) ? obj.rows :
     Array.isArray(obj.articles) ? obj.articles :
     []) as any[];

  return arr.map((x) => ({
    title: typeof x?.title === "string" ? x.title : null,
    url: typeof x?.url === "string" ? x.url : null,
    discovered_at: typeof x?.discovered_at === "string" ? x.discovered_at : null,
    published_at: typeof x?.published_at === "string" ? x.published_at : null,
  }));
}

const fmtDT = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString() : "—";

/* ───────────────────────── Component ───────────────────────── */

export default function SourcesTable() {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  // toolbar
  const [q, setQ] = useState("");
  const [hideTeams, setHideTeams] = useState(false);
  const [sortKey, setSortKey] = useState<"name" | "method" | "id">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // “last 10” inline expand state, per source id
  const [open, setOpen] = useState<Record<
    number,
    { loading: boolean; error: string | null; items: RecentItem[] | null }
  >>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      setFetchErr(null);
      try {
        const res = await fetch("/api/admin/sources", { cache: "no-store" });
        let bodyText = "";
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          try { bodyText = await res.text(); } catch {}
        }
        if (!res.ok) {
          setRows([]);
          setFetchErr(
            (json as any)?.error || (json as any)?.message || bodyText || `HTTP ${res.status}`
          );
          return;
        }
        const list = normalizeList(json);
        if (!list.length && (json as any)?.ok === false) {
          setFetchErr((json as any)?.error || "API returned ok=false");
        }
        setRows(list);
      } catch (e) {
        setFetchErr((e as Error).message);
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const methodOf = (r: SourceRow): string => {
    if (r.fetch_mode === "rss") return "RSS";
    if (r.fetch_mode === "adapter" || r.scraper_key) {
      return `Adapter${r.scraper_key ? ` (${r.scraper_key})` : ""}`;
    }
    if (r.scrape_selector) return "Scrape";
    return "Auto";
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
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
    else { setSortKey(k); setSortDir("asc"); }
  }

  function openEditor(id: number) {
    window.dispatchEvent(new CustomEvent("source:open", { detail: { id } }));
    window.location.hash = `source-${id}`;
  }

  const compactConfig = (c: SourceRow["adapter_config"]): string => {
    if (!c || Object.keys(c).length === 0) return "{}";
    try {
      const s = JSON.stringify(c);
      return s.length > 24 ? s.slice(0, 24) + "…" : s;
    } catch { return "{}"; }
  };

  async function loadRecent(id: number) {
    setOpen((m) => ({ ...m, [id]: { loading: true, error: null, items: m[id]?.items ?? null } }));
    try {
      const res = await fetch(`/api/admin/sources/recent?sourceId=${id}&limit=10`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any)?.error || `HTTP ${res.status}`);
      const items = normalizeRecent(json);
      setOpen((m) => ({ ...m, [id]: { loading: false, error: null, items } }));
    } catch (e) {
      setOpen((m) => ({ ...m, [id]: { loading: false, error: (e as Error).message, items: null } }));
    }
  }

  function toggleRecent(id: number) {
    const state = open[id];
    if (state) {
      // collapse
      const { [id]: _, ...rest } = open;
      setOpen(rest);
    } else {
      // expand + fetch
      loadRecent(id);
    }
  }

  // number of columns (update if you add/remove headers)
  const COLS = 8;

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-9 w-72 max-w-full rounded border px-3 text-sm"
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
        <span className="text-xs text-zinc-500">{filtered.length} / {rows.length}</span>
      </div>

      {/* table */}
      <div className="overflow-x-visible"> {/* let cells wrap; avoid forced horizontal scroll */}
        {loading ? (
          <div className="p-3 text-sm text-zinc-600">Loading…</div>
        ) : fetchErr ? (
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            Failed to load sources: {fetchErr}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded border p-3 text-sm text-zinc-600">
            No sources to show. Try clearing the search or unchecking “Hide team pages”.
          </div>
        ) : (
          <table className="w-full table-auto text-sm">
            <thead className="bg-zinc-50">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th className="cursor-pointer" onClick={() => toggleSort("id")}>
                  id {sortKey === "id" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="cursor-pointer" onClick={() => toggleSort("name")}>
                  name {sortKey === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="cursor-pointer" onClick={() => toggleSort("method")}>
                  method {sortKey === "method" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th>homepage</th>
                <th>rss</th>
                <th>adapter config</th>
                <th>test</th>
                <th>last 10</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isOpen = !!open[r.id];
                const state = open[r.id];
                return (
                  <>
                    <tr key={r.id} className="border-t align-top">
                      <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                      <td className="px-3 py-2 break-words">{r.name ?? "—"}</td>
                      <td className="px-3 py-2">
                        {r.fetch_mode === "rss"
                          ? "RSS"
                          : r.fetch_mode === "adapter" || r.scraper_key
                          ? `Adapter${r.scraper_key ? ` (${r.scraper_key})` : ""}`
                          : r.scrape_selector
                          ? "Scrape"
                          : "Auto"}
                      </td>
                      <td className="px-3 py-2">
                        {r.homepage_url ? (
                          <a className="text-blue-700 underline break-all"
                             href={r.homepage_url} target="_blank" rel="noreferrer">
                            homepage
                          </a>
                        ) : ("—")}
                      </td>
                      <td className="px-3 py-2">
                        {r.rss_url ? (
                          <a className="text-blue-700 underline break-all"
                             href={r.rss_url} target="_blank" rel="noreferrer">
                            rss
                          </a>
                        ) : ("—")}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex flex-wrap items-center gap-2">
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
                          <span className="rounded bg-zinc-100 px-1.5 font-mono text-xs text-zinc-700 break-all">
                            {compactConfig(r.adapter_config)}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <a
                          className="rounded border px-2 py-0.5 text-xs hover:bg-zinc-50"
                          href={`/api/admin/ingest?sourceId=${r.id}&limit=50&includeHealth=1`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Test
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          className="rounded border px-2 py-0.5 text-xs hover:bg-zinc-50"
                          onClick={() => toggleRecent(r.id)}
                          aria-expanded={isOpen}
                          aria-controls={`recent-${r.id}`}
                        >
                          {isOpen ? "Hide last 10" : "Show last 10"}
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr id={`recent-${r.id}`}>
                        <td colSpan={COLS} className="bg-zinc-50/50 px-3 py-2">
                          {state?.loading ? (
                            <div className="text-xs text-zinc-600">Loading recent articles…</div>
                          ) : state?.error ? (
                            <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                              Failed to load: {state.error}
                            </div>
                          ) : (state?.items?.length ?? 0) === 0 ? (
                            <div className="text-xs text-zinc-600">No recent items.</div>
                          ) : (
                            <ul className="space-y-1">
                              {state!.items!.map((it, i) => (
                                <li key={i} className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                                  <span className="font-medium">
                                    {it.url ? (
                                      <a className="underline text-emerald-700 break-words" href={it.url} target="_blank" rel="noreferrer">
                                        {it.title || it.url}
                                      </a>
                                    ) : (
                                      <span className="break-words">{it.title || "Untitled"}</span>
                                    )}
                                  </span>
                                  <span className="text-xs text-zinc-500">
                                    {fmtDT(it.discovered_at)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
