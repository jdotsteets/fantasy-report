// components/LoadMoreSection.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import Section from "@/components/Section";
import ArticleList from "@/components/ArticleList";
import type { Article } from "@/types/sources";

type SectionKey = "rankings" | "start-sit" | "waiver-wire" | "dfs" | "injury" | "advice" | "news";

type Props = {
  title: string;
  sectionKey: SectionKey;
  initialItems: Article[];
  pageSize?: number;
  days?: number;
  week?: number | null; // only relevant for waiver-wire
};

export default function LoadMoreSection({
  title,
  sectionKey,
  initialItems,
  pageSize = 10,
  days = 45,
  week = null,
}: Props) {
  const [items, setItems] = useState<Article[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef<number>(initialItems.length);

  const btnLabel = useMemo(
    () => `More ${title.replace(/ &.*/i, "")}`, // e.g., "More Start/Sit"
    [title]
  );

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

      const res = await fetch(`/api/section?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { items: Article[] } = await res.json();

      // de-dupe by id (in case offset overlaps with new rows)
      const seen = new Set(items.map((x) => x.id));
      const fresh = data.items.filter((x) => !seen.has(x.id));
      setItems((cur) => [...cur, ...fresh]);

      // advance offset by what the API *returned*
      offsetRef.current += data.items.length;

      if (data.items.length < pageSize) setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load more");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section title={title}>
      <ArticleList items={items} />

      {/* Row: More … */}
      <div className="mt-2">
        {error ? (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {!done ? (
          <button
            onClick={loadMore}
            className="w-full rounded-lg border px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Loading…" : btnLabel}
          </button>
        ) : (
          <div className="w-full select-none px-3 py-2 text-center text-xs text-zinc-500">
            No more {title.toLowerCase()}.
          </div>
        )}
      </div>
    </Section>
  );
}
