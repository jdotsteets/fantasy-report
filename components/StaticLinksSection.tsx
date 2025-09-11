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
  id: string | number;                // ← accept both
  title: string | null;
  url: string | null;
  discovered_at?: string | null;
};

/* -------- normalize without `any` -------- */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const toStaticRow = (v: unknown): StaticRow | null => {
  if (!isObj(v)) return null;
  const idRaw = v.id;
  const hasId =
    typeof idRaw === "number" ||
    (typeof idRaw === "string" && idRaw.trim().length > 0);
  if (!hasId) return null;

  const title =
    typeof v.title === "string" ? v.title : null;
  const url =
    typeof v.url === "string" ? v.url : null;
  const discovered_at =
    typeof (v as { discovered_at?: unknown }).discovered_at === "string"
      ? (v as { discovered_at: string }).discovered_at
      : null;

  return { id: (idRaw as string | number), title, url, discovered_at };
};

function normalizeStatic(payload: unknown): StaticRow[] {
  const read = (arr: unknown): StaticRow[] =>
    Array.isArray(arr)
      ? arr.map(toStaticRow).filter((x): x is StaticRow => x !== null)
      : [];

  if (Array.isArray(payload)) return read(payload);
  if (isObj(payload)) {
    if ("items" in payload) return read((payload as { items: unknown }).items);
    if ("rows" in payload) return read((payload as { rows: unknown }).rows);
    if ("articles" in payload) return read((payload as { articles: unknown }).articles);
  }
  return [];
}

/* -------- small helpers -------- */
function domainFromUrl(u: string | null): string | null {
  if (!u) return null;
  try { return new URL(u).hostname; } catch { return null; }
}
function faviconUrl(domain: string | null): string | null {
  return domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null;
}
function labelFor(kind: StaticType): string {
  switch (kind) {
    case "rankings_ros":    return "Rankings Rest of Season";
    case "rankings_weekly": return "Weekly Rankings";
    case "dfs_tools":       return "DFS Tools";
    case "projections":     return "Projections";
    case "waiver_wire":     return "Waiver Wire";
    default:                return "Stats";
  }
}
const nextKind = (k: StaticType) => CYCLE[(CYCLE.indexOf(k) + 1) % CYCLE.length];
const prevKind = (k: StaticType) => CYCLE[(CYCLE.indexOf(k) - 1 + CYCLE.length) % CYCLE.length];

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
        const res = await fetch(`/api/home/static?type=${kind}&limit=12&sport=nfl`, { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; items?: unknown; error?: string };
        if (!res.ok || json.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
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
    return () => { cancelled = true; };
  }, [kind]);

  const header = useMemo(() => labelFor(kind), [kind]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <header className="relative rounded-t-2xl border-b border-zinc-200">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-t-2xl bg-gradient-to-b from-emerald-800/10 to-emerald-800/0" />
        <div className="relative flex items-center justify-between px-4 py-3">
          <button className="rounded px-2 py-1 text-xl leading-none hover:bg-zinc-100" aria-label="Previous list" onClick={() => setKind(k => prevKind(k))}>◀</button>
          <h2 className="text-lg font-semibold text-zinc-900">{header}</h2>
          <button className="rounded px-2 py-1 text-xl leading-none hover:bg-zinc-100" aria-label="Next list" onClick={() => setKind(k => nextKind(k))}>▶</button>
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
                <li key={String(a.id)} className="py-2">
                  <a
                    href={a.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 cursor-pointer text-zinc-900 visited:text-zinc-900 hover:text-emerald-700 focus-visible:text-emerald-700 transition-colors"
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
