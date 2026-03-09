"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BetaSection from "@/components/beta/BetaSection";
import BetaFeed from "@/components/beta/BetaFeed";
import type { Article } from "@/types/sources";

type SectionKey =
  | "rankings"
  | "start-sit"
  | "waiver-wire"
  | "dfs"
  | "injury"
  | "advice"
  | "news";

type Props = {
  title: string;
  sectionKey: SectionKey;
  initialItems: Article[];
  pageSize?: number;
  initialDisplay?: number;
  days?: number;
  week?: number | null;
  sourceId?: number;
  provider?: string;
  subtitle?: string;
};

export default function BetaLoadMoreSection({
  title,
  sectionKey,
  initialItems,
  pageSize = 10,
  initialDisplay = 6,
  days = 45,
  week = null,
  sourceId,
  provider,
  subtitle,
}: Props) {
  const [items, setItems] = useState<Article[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const offsetRef = useRef<number>(initialItems.length);

  useEffect(() => {
    setItems(initialItems);
    offsetRef.current = initialItems.length;
    const shouldEnd = initialItems.length < pageSize && initialItems.length <= initialDisplay;
    setDone(shouldEnd);
    setError(null);
    setExpanded(false);
  }, [initialItems, pageSize, initialDisplay, sectionKey, days, week, sourceId, provider]);

  const btnLabel = useMemo(() => `More ${title.replace(/ &.*/i, "")}`, [title]);

  async function loadMore() {
    if (loading || done) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        key: sectionKey,
        limit: String(pageSize),
        offset: String(offsetRef.current),
        days: String(days),
      });
      if (sectionKey === "waiver-wire" && week != null) params.set("week", String(week));
      if (typeof sourceId === "number" && Number.isFinite(sourceId)) {
        params.set("sourceId", String(sourceId));
      }
      if (typeof provider === "string" && provider.trim() !== "") {
        params.set("provider", provider);
      }

      const res = await fetch(`/api/section?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { items: Article[] } = await res.json();

      const seen = new Set(items.map((x) => x.id));
      const fresh = data.items.filter((x) => !seen.has(x.id));
      setItems((cur) => [...cur, ...fresh]);

      offsetRef.current += data.items.length;
      if (data.items.length < pageSize) setDone(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load more";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const displayLimit = expanded ? undefined : initialDisplay;
  const canExpand = items.length > initialDisplay || !done;

  async function handleExpand() {
    setExpanded(true);
    await loadMore();
  }

  return (
    <BetaSection title={title} subtitle={subtitle}>
      <BetaFeed articles={items} limit={displayLimit} />

      {canExpand ? (
        <div className="mt-4">
          {error ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {!expanded ? (
            <button
              onClick={handleExpand}
              className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Loading…" : "More Articles"}
            </button>
          ) : !done ? (
            <button
              onClick={loadMore}
              className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Loading…" : btnLabel}
            </button>
          ) : items.length > initialDisplay ? (
            <button
              onClick={() => setExpanded(false)}
              className="w-full rounded-full border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Show Less
            </button>
          ) : null}
        </div>
      ) : null}
    </BetaSection>
  );
}
