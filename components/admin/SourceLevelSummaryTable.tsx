"use client";

import { useEffect, useMemo, useState } from "react";

/** Minimal source row just to learn categories by id */
type SourceCatalogRow = {
  id: number;
  category?: string | null;
  allowed?: boolean | null;
};

type IngestRowInput = Record<string, unknown>;

type IngestRow = {
  source_id: number;
  source: string;
  inserted: number;
  updated: number;
  skipped: number;
  lastAt: string | null;             // ISO string (normalized)
  homepage_url: string | null;
  rss_url: string | null;
  allowed?: boolean | null;
  category?: string | null;
};

/* ── helpers that accept multiple shapes ─────────────────────────────── */

function toNumber(v: unknown, def = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return def;
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function toBoolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Normalize a dateish value to ISO string (or null). */
function toIsoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/* ── tolerant row normalizer (key aliasing + type coercion) ──────────── */

function toIngestRow(v: IngestRowInput): IngestRow | null {
  const id = typeof v["source_id"] === "number" ? (v["source_id"] as number) : NaN;
  const name = toStringOrNull(v["source"]);
  if (!Number.isFinite(id) || !name) return null;

  // numeric tallies (accept strings too)
  const inserted = toNumber(v["inserted"]);
  const updated  = toNumber(v["updated"]);
  const skipped  = toNumber(v["skipped"]);

  // date under several possible keys
  const lastAtRaw =
    v["lastAt"] ?? v["last_at"] ?? v["last"] ?? v["lastSeen"] ?? v["last_seen"];
  const lastAt = toIsoDate(lastAtRaw);

  // links (accept camelCase or snake_case)
  const homepage_url =
    toStringOrNull(v["homepage_url"]) ?? toStringOrNull(v["homepageUrl"]) ?? null;
  const rss_url =
    toStringOrNull(v["rss_url"]) ?? toStringOrNull(v["rssUrl"]) ?? null;

  // optional flags
  const allowed = toBoolOrNull(v["allowed"]);
  const category =
    toStringOrNull(v["category"]) ??
    toStringOrNull((v as Record<string, unknown>)["source_category"]) ??
    null;

  return {
    source_id: id,
    source: name,
    inserted,
    updated,
    skipped,
    lastAt,
    homepage_url,
    rss_url,
    allowed,
    category,
  };
}

/* ── component stays the same below this line ───────────────────────── */

type Props = {
  rows: IngestRowInput[];
  windowHours: number;
};

export default function SourceLevelSummaryTable({ rows, windowHours }: Props) {
  const [hideTeams, setHideTeams] = useState(false);
  const [sortKey, setSortKey] = useState<"source" | "inserted" | "updated" | "skipped" | "lastAt">(
    "lastAt"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const ingestRows: IngestRow[] = useMemo(() => {
    const out: IngestRow[] = [];
    for (const r of rows) {
      const n = toIngestRow(r);
      if (n) out.push(n);
    }
    return out;
  }, [rows]);

  const [catalog, setCatalog] = useState<Map<number, SourceCatalogRow>>(new Map());
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadErr(null);
      try {
        const res = await fetch("/api/admin/sources", { cache: "no-store" });
        const json = (await res.json()) as unknown;
        const items: SourceCatalogRow[] = Array.isArray(json)
          ? (json as SourceCatalogRow[])
          : Array.isArray((json as Record<string, unknown> | null)?.rows)
          ? ((json as Record<string, unknown>).rows as SourceCatalogRow[])
          : Array.isArray((json as Record<string, unknown> | null)?.sources)
          ? ((json as Record<string, unknown>).sources as SourceCatalogRow[])
          : [];

        const m = new Map<number, SourceCatalogRow>();
        for (const it of items) {
          if (typeof it?.id === "number") m.set(it.id, it);
        }
        if (!cancelled) setCatalog(m);
      } catch (e) {
        if (!cancelled) setLoadErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const merged: IngestRow[] = useMemo(() => {
    if (catalog.size === 0) return ingestRows;
    return ingestRows.map((r) => {
      const c = catalog.get(r.source_id);
      return c ? { ...r, category: c.category ?? r.category, allowed: c.allowed ?? r.allowed } : r;
    });
  }, [ingestRows, catalog]);

  const filteredSorted = useMemo(() => {
    const base = merged.filter((r) => {
      if (hideTeams && (r.category ?? "").toLowerCase() === "team") return false;
      return r.inserted + r.updated + r.skipped > 0;
    });

    const dirMul = sortDir === "asc" ? 1 : -1;
    const valOf = (r: IngestRow) => {
      if (sortKey === "source") return r.source.toLowerCase();
      if (sortKey === "lastAt") return r.lastAt ? Date.parse(r.lastAt) : 0;
      if (sortKey === "inserted") return r.inserted;
      if (sortKey === "updated") return r.updated;
      return r.skipped;
    };

    return [...base].sort((a, b) => {
      const av = valOf(a) as number | string;
      const bv = valOf(b) as number | string;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dirMul;
      return String(av).localeCompare(String(bv)) * dirMul;
    });
  }, [merged, hideTeams, sortKey, sortDir]);

  function toggleSort(k: typeof sortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex select-none items-center gap-2">
          <input
            type="checkbox"
            checked={hideTeams}
            onChange={(e) => setHideTeams(e.target.checked)}
          />
          Hide team sources
        </label>
        {loadErr ? (
          <span className="text-rose-700">Failed to load categories: {loadErr}</span>
        ) : null}
        <span className="text-xs text-zinc-500">
          {filteredSorted.length} / {ingestRows.length}
        </span>
      </div>

      {filteredSorted.length === 0 ? (
        <div className="rounded border p-3 text-sm text-zinc-600">
          No source activity in the last {windowHours} hours.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th className="cursor-pointer select-none" onClick={() => toggleSort("source")}>
                  source {sortKey === "source" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("inserted")}>
                  inserted {sortKey === "inserted" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("updated")}>
                  updated {sortKey === "updated" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("skipped")}>
                  skipped {sortKey === "skipped" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("lastAt")}>
                  last seen {sortKey === "lastAt" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th>links</th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((r) => (
                <tr key={r.source_id} className="border-t">
                  <td className="px-3 py-2">
                    <a
                      href={`/admin/sources#source-${r.source_id}`}
                      className="text-emerald-700 underline"
                    >
                      {r.source}
                    </a>
                    {r.allowed === false ? (
                      <span className="ml-2 rounded bg-zinc-200 px-1.5 text-xs text-zinc-700">
                        disabled
                      </span>
                    ) : null}
                    {r.category ? (
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 text-[10px] text-zinc-600">
                        {r.category}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{r.inserted}</td>
                  <td className="px-3 py-2">{r.updated}</td>
                  <td className="px-3 py-2">{r.skipped}</td>
                  <td className="px-3 py-2">
                    {r.lastAt ? new Date(r.lastAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {r.homepage_url ? (
                        <a
                          className="text-blue-700 underline"
                          href={r.homepage_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          homepage
                        </a>
                      ) : null}
                      {r.rss_url ? (
                        <a
                          className="text-blue-700 underline"
                          href={r.rss_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          rss
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
