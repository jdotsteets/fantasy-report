// lib/ingestRunner.ts
import { allowItem } from "@/lib/contentFilter";
import { upsertArticle } from "@/lib/ingest";
import { fetchItemsForSource } from "./sources";
import type { FeedItem as AdapterFeedItem } from "./sources/types";

export type IngestYield = {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  delta: number;
  meta?: Record<string, unknown>;
};

export type IngestParams = {
  sourceId?: number;
  limit: number;
  debug: boolean;
  jobId?: string;
  sport?: string | null;
};

// Attach source_id so the upsert can rely on it
type FeedItem = AdapterFeedItem & { source_id?: number | null };

/** Skip obvious non-article pages (home/section indexes, shallow paths). */
// in lib/ingestRunner.ts
function isLikelyArticleUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const p = url.pathname.replace(/\/+$/, "");
    if (!p || p === "/") return false;

    // obvious hubs
    if (/(^|\/)(articles|index|rankings|tools|podcasts?|videos?)\/?$/.test(p)) return false;

    // dated URLs like /2025/09/03/..., or any long numeric id in the path
    if (/\/20\d{2}[/-]\d{1,2}(?:[/-]\d{1,2})?\//.test(p)) return true;
    if (/\b\d{4,}\b/.test(p)) return true;

    const parts = p.split("/").filter(Boolean);
    // depth >= 3 still allowed
    if (parts.length >= 3) return true;

    // depth-2 like /news/some-title
    const last = parts[parts.length - 1] || "";
    if (parts.length >= 2 && /[a-z][-_][a-z]/i.test(last)) return true;

    // some sites use ?id= or ?storyId=
    const sp = url.searchParams;
    if (sp.has("id") || sp.has("storyId") || sp.has("cid")) return true;

    return false;
  } catch {
    return false;
  }
}


/** Fetch candidate items using the configured adapter for the source. */
async function fetchFeedItems(
  sourceId: number | undefined,
  limit: number
): Promise<FeedItem[]> {
  if (!sourceId) return [];
  const items = await fetchItemsForSource(sourceId, limit);
  return items.map((it) => ({ ...it, source_id: sourceId }));
}

// ---- helpers to keep only obvious non-articles out ----
function isUtilityUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const p = url.pathname.toLowerCase();
    // hard skips (known non-articles)
    if (p === "/" || p === "") return true;                     // homepage
    if (p.includes("sitemap")) return true;                     // sitemaps
    if (p.includes("google-news")) return true;                 // google news index pages
    if (p.includes("watch") || p.includes("videos")) return true; // video hubs
    if (p.includes("where-to-watch")) return true;
    return false;
  } catch {
    return true;
  }
}

export async function* runIngestOnce(
  params: IngestParams
): AsyncGenerator<IngestYield, void, unknown> {
  const { sourceId, limit, debug, jobId, sport } = params;

  yield { level: "info", message: "Fetching candidate items", delta: 0, meta: { limit, sourceId, sport } };
  const feedItems = await fetchFeedItems(sourceId, limit);

  yield { level: "debug", message: "Fetched feed items", delta: 0, meta: { count: feedItems.length } };

  let inserted = 0;
  let updated = 0;

  for (const item of feedItems) {
    const link = item.link ?? "";
    try {
      if (isUtilityUrl(link)) {
        if (debug) yield { level: "debug", message: "Skipped utility/index page", delta: 0, meta: { link } };
        continue;
      }

      // Content filter (still keeps out junk)
      const allowed = allowItem(
        { title: item.title ?? "", link, description: item.description ?? "" },
        link
      );
      if (!allowed) {
        if (debug) yield { level: "debug", message: "Skipped by content filter", delta: 0, meta: { link } };
        continue;
      }

      // ---- Upsert (send BOTH sourceId and source_id to be safe) ----
      const upsertInput: any = {
        sourceId: (item.source_id ?? sourceId) as number,
        source_id: (item.source_id ?? sourceId) as number,
        title: item.title ?? "",
        link,
        author: item.author ?? null,
        publishedAt: (item as any).publishedAt ?? null,
        debug,
        jobId,
      };

      const raw: any = await upsertArticle(upsertInput);

      // Normalize result regardless of the helper’s return shape
      const isInserted =
        typeof raw === "string" ? raw === "inserted" :
        !!(raw?.inserted ?? raw?.isNew ?? raw?.created ?? raw?.upserted);

      const isUpdated =
        typeof raw === "string" ? raw === "updated" :
        !!(raw?.updated ?? raw?.wasUpdated ?? raw?.changed);

      if (isInserted) {
        inserted += 1;
        yield { level: "info", message: "Inserted article", delta: 1, meta: { link } };
      } else if (isUpdated) {
        updated += 1;
        yield { level: "info", message: "Updated existing article", delta: 0, meta: { link } };
      } else {
        if (debug) yield { level: "debug", message: "Upsert returned no change", delta: 0, meta: { link, raw } };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      yield { level: "error", message: "Insert failed", delta: 0, meta: { error: msg, link } };
    }
  }

  yield {
    level: "info",
    message: "Ingest summary",
    delta: 0,
    meta: { total: feedItems.length, inserted, updated },
  };
}
