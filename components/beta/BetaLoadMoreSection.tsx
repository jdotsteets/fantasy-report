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
  variant = "feed",
}: Props & { variant?: "feed" | "headlines" }) {
  const [items, setItems] = useState<Article[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewState, setViewState] = useState<"collapsed" | "expanded" | "loaded">("collapsed");
  const offsetRef = useRef<number>(initialItems.length);

  useEffect(() => {
    setItems(initialItems);
    offsetRef.current = initialItems.length;
    setDone(initialItems.length < pageSize);
    setError(null);
    setViewState("collapsed");
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

      setItems((cur) => {
        const seen = new Set(cur.map((x) => x.id));
        const fresh = data.items.filter((x) => !seen.has(x.id));
        return [...cur, ...fresh];
      });

      offsetRef.current += data.items.length;
      if (data.items.length < pageSize) setDone(true);
      setViewState("loaded");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load more";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Handle local expansion (show all initial items without API call)
  function handleExpand() {
    setViewState("expanded");
    
    // Optional: Track expansion analytics
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "section_expand", {
        section: sectionKey,
        initial_count: initialItems.length,
      });
    }
  }

  // Handle collapse back to initial limit
  function handleCollapse() {
    setViewState("collapsed");
  }

  // Determine visible items based on view state
  const visibleItems = viewState === "collapsed" ? items.slice(0, initialDisplay) : items;

  // Count of hidden initial items
  const hiddenInitialCount = Math.max(0, initialItems.length - initialDisplay);
  
  // Show expand button if there are hidden items
  const showExpandButton = viewState === "collapsed" && hiddenInitialCount > 0;
  
  // Show load more button if expanded and not done
  const showLoadMoreButton = viewState === "expanded" && !done;
  
  // Show collapse button if expanded or loaded
  const showCollapseButton = (viewState === "expanded" || viewState === "loaded") && items.length > initialDisplay;

  return (
    <BetaSection title={title} subtitle={subtitle}>
      {variant === "headlines" ? (
        <div className="space-y-2">
          {visibleItems.map((article, idx) => (
            <a
              key={article.id}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-zinc-200 bg-white px-3 py-3 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-[11px] font-semibold text-zinc-400">
                  {String(idx + 1).padStart(2, "0")}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-900">
                    {article.title}
                  </div>

                  <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="truncate">{article.source}</span>
                    {article.published_at ? (
                      <>
                        <span>·</span>
                        <span>{new Date(article.published_at).toLocaleDateString()}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <BetaFeed articles={visibleItems} />
      )}

      <div className="mt-4 space-y-2">
        {error && (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Show X more button (expands initial items locally) */}
        {showExpandButton && (
          <button
            onClick={handleExpand}
            className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
          >
            Show {hiddenInitialCount} more
          </button>
        )}

        {/* Load more from API */}
        {showLoadMoreButton && (
          <button
            onClick={loadMore}
            className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Loading…" : "More Articles"}
          </button>
        )}

        {/* Continue loading after API load */}
        {viewState === "loaded" && !done && (
          <button
            onClick={loadMore}
            className="w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Loading…" : btnLabel}
          </button>
        )}

        {/* Show less button */}
        {showCollapseButton && (
          <button
            onClick={handleCollapse}
            className="w-full rounded-full border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Show Less
          </button>
        )}
      </div>
    </BetaSection>
  );
}
