// lib/ingestRunner.ts
import { allowItem } from "@/lib/contentFilter";
import { upsertArticle } from "@/lib/ingest";
import { fetchItemsForSource } from "./sources";
import type { FeedItem as AdapterFeedItem  } from "./sources/types";

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

// We attach source_id so the upsert can use it
type FeedItem = AdapterFeedItem & { source_id?: number | null };

/** Skip obvious non-article pages (home/section indexes, shallow paths). */
function isLikelyArticleUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const p = url.pathname.replace(/\/+$/, ""); // trim trailing slash
    if (p === "" || p === "/") return false; // homepage
    if (p === "/articles" || p === "/articles/nfl") return false; // section index
    // Many article URLs have a numeric id segment; allow if present
    if (/\b\d{4,}\b/.test(p)) return true;
    // Otherwise allow if the path is deep enough to look like an article
    return p.split("/").filter(Boolean).length >= 3;
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

/** Run a single ingest pass and stream progress via yields. */
export async function* runIngestOnce(
  params: IngestParams
): AsyncGenerator<IngestYield, void, unknown> {
  const { sourceId, limit, debug, jobId, sport } = params;

  yield {
    level: "info",
    message: "Fetching candidate items",
    delta: 0,
    meta: { limit, sourceId },
  };

  const feedItems = await fetchFeedItems(sourceId, limit);

  yield {
    level: "debug",
    message: "Fetched feed items",
    delta: 0,
    meta: { count: feedItems.length },
  };

  let inserted = 0;
  let updated = 0;

  for (const item of feedItems) {
    const link = item.link ?? "";
    try {
      if (!isLikelyArticleUrl(link)) {
        if (debug) {
          yield {
            level: "debug",
            message: "Skipped non-article/index page",
            delta: 0,
            meta: { link },
          };
        }
        continue;
      }

      // Content filter expects a FeedLike + a second arg (prefer the URL)
      const feedLike = {
        title: item.title ?? "",
        link,
        description: item.description ?? "",
      };
      const allowed = allowItem(feedLike, link);
      if (!allowed) {
        if (debug) {
          yield {
            level: "debug",
            message: "Skipped by content filter",
            delta: 0,
            meta: { link },
          };
        }
        continue;
      }

      // Canonical upsert path (handles URL normalization and NOT NULL safety)
      const status = await upsertArticle(
        item.source_id ?? (sourceId as number),
        {
          title: item.title ?? "",
          link,
          author: item.author ?? null,
          publishedAt: item.publishedAt ?? null,
          description: item.description ?? null,
          imageUrl: item.imageUrl ?? null,
        },
        sport ?? null,
        { jobId }
      );

      if (status === "inserted") {
        inserted += 1;
        yield {
          level: "info",
          message: "Inserted article",
          delta: 1,
          meta: { link },
        };
      } else if (status === "updated") {
        updated += 1;
        yield {
          level: "debug",
          message: "Updated existing article",
          delta: 0,
          meta: { link },
        };
      } else {
        // "skipped" (e.g., invalid URL after normalization)
        if (debug) {
          yield {
            level: "debug",
            message: "Upsert skipped",
            delta: 0,
            meta: { link },
          };
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      yield {
        level: "error",
        message: "Insert failed",
        delta: 0,
        meta: { error: msg, link },
      };
    }
  }

  yield {
    level: "info",
    message: "Ingest summary",
    delta: 0,
    meta: { total: feedItems.length, inserted, updated },
  };
}
