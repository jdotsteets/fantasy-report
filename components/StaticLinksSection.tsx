// components/StaticLinksSection.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { StaticType } from "@/lib/staticTypes";
import Image from "next/image";

const CYCLE: StaticType[] = [
  "rankings_ros",
  "rankings_weekly",
  "dfs_tools",
  "projections",
  "waiver_wire",
  "stats",
];

type StaticRow = {
  id: number;
  title: string | null;
  url: string | null;
  discovered_at?: string | null;
};

/* ───────── Type guards (no `any`) ───────── */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isNullableString = (v: unknown): v is string | null | undefined =>
  typeof v === "string" || v === null || typeof v === "undefined";

function isStaticRow(v: unknown): v is StaticRow {
  if (!isRecord(v)) return false;
  const id = v.id;
  const title = v.title;
  const url = v.url;
  const discovered_at = (v as { discovered_at?: unknown }).discovered_at;
  return (
    typeof id === "number" &&
    isNullableString(title) &&
    isNullableString(url) &&
    isNullableString(discovered_at)
  );
}

function isStaticRowArray(v: unknown): v is StaticRow[] {
  return Array.isArray(v) && v.every(isStaticRow);
}

function normalizeStatic(payload: unknown): StaticRow[] {
  if (isStaticRowArray(payload)) return payload;

  if (isRecord(payload)) {
    const items = (payload as { items?: unknown }).items;
    if (isStaticRowArray(items)) return items;

    const rows = (payload as { rows?: unknown }).rows;
    if (isStaticRowArray(rows)) return rows;

    const articles = (payload as { articles?: unknown }).articles;
    if (isStaticRowArray(articles)) return articles;
  }

  return [];
}

function domainFromUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
}

function faviconUrl(domain: string | null): string | null {
  return domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null;
}

function labelFor(kind: StaticType): string {
  switch (kind) {
    case "rankings_ros":
      return "Rankings Rest of Season";
    case "rankings_weekly":
      return "Weekly Rankings";
    case "dfs_tools":
      return "DFS Tools";
    case "projections":
      return "Projections";
    case "waiver_wire":
      return "Waiver Wire";
    default:
      return "Stats";
  }
}

function nextKind(k: StaticType): StaticType {
  const i = CYCLE.indexOf(k);
  return CYCLE[(i + 1) % CYCLE.length];
}
function prevKind(k: StaticType): StaticType {
  const i = CYCLE.indexOf(k);
  return CYCLE[(i - 1 + CYCLE.length) % CYCLE.length];
}

export default function StaticLinksSection({ initial = "rankings_ros" as StaticType }) {
  const [kind, setKind] = useState<StaticType>(initial);
  const [items, setItems] = useState<StaticRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

useEffect(() => {
  let cancelled = false;
  (async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/home/static?type=${kind}&limit=12&sport=nfl`, {
        cache: "no-store",
      });

      const json = (await res.json()) as { ok?: boolean; items?: unknown; error?: string };

      if (!res.ok || json.ok === false) {
        throw new Error(json?.error || `HTTP ${res.status} ${res.statusText}`);
      }

      const list = normalizeStatic(json.items ?? json);
      if (!cancelled) setItems(list);
    } catch (e) {
      if (!cancelled) {
        setItems([]);
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    } finally {
      if (!cancelled) setLoading(false);
    }
  })();
  return () => {
    cancelled = true;
  };
}, [kind]);

  const header = useMemo(() => labelFor(kind), [kind]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {/* Header styled like Section.tsx + arrows */}
      <header className="relative rounded-t-2xl border-b border-zinc-200">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-t-2xl bg-gradient-to-b from-emerald-800/10 to-emerald-800/0"
        />
        <div className="relative flex items-center justify-between px-4 py-3">
          <button
            className="rounded px-2 py-1 text-xl leading-none hover:bg-zinc-100"
            aria-label="Previous list"
            onClick={() => setKind((k) => prevKind(k))}
          >
            ◀
          </button>
          <h2 className="text-lg font-semibold text-zinc-900">{header}</h2>
          <button
            className="rounded px-2 py-1 text-xl leading-none hover:bg-zinc-100"
            aria-label="Next list"
            onClick={() => setKind((k) => nextKind(k))}
          >
            ▶
          </button>
        </div>
      </header>

      <div className="p-2">
        {loading ? (
          <div className="p-2 text-sm text-zinc-600">Loading…</div>
        ) : error ? (
          <div className="p-2 text-sm text-black">Failed to load: {error}</div>
        ) : items.length === 0 ? (
          <div className="p-2 text-sm text-zinc-600">No links yet.</div>
        ) : (
          <ul className="divide-y divide-zinc-200 px-3 md:px-4">
            {items.map((a) => {
              const d = domainFromUrl(a.url ?? null);
              const ico = faviconUrl(d);
              const title = a.title || a.url || "Untitled";
              return (
                <li key={a.id} className="py-2">
                  <a
                    href={a.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 cursor-pointer
                               text-zinc-900 visited:text-zinc-900
                               hover:text-emerald-700 focus-visible:text-emerald-700
                               transition-colors"
                  >
                    {ico ? (
                      <Image
                        src={ico}
                        alt=""
                        width={18}
                        height={18}
                        className="shrink-0 rounded"
                        loading="lazy"
                        unoptimized
                      />
                    ) : null}
                    <span className="break-words">{title}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
