// components/StaticLinksSection.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { StaticType } from "@/lib/staticTypes";

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

function normalizeStatic(payload: unknown): StaticRow[] {
  if (Array.isArray(payload)) return payload as StaticRow[];
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items as StaticRow[];
    if (Array.isArray(o.rows)) return o.rows as StaticRow[];
    if (Array.isArray((o as any).articles)) return (o as any).articles as StaticRow[];
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
        const json = await res.json().catch(() => ({}));
        const list = normalizeStatic(json);
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) {
          setItems([]);
          setError((e as Error).message);
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
                        <img
                          src={ico}
                          alt=""
                          width={18}
                          height={18}
                          className="shrink-0 rounded"
                          loading="lazy"
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
