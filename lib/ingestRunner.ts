//lib/ingestRunner.ts

import { allowItem } from "@/lib/contentFilter";
import { upsertArticle } from "@/lib/ingest";
import { fetchItemsForSource } from "./sources";
import type { FeedItem as SourceFeedItem, ProbeMethod } from "./sources/types";

/* ---------- types ---------- */

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
  method?: ProbeMethod;
  jobId?: string;
  sport?: string | null;
};

// Attach source_id so upsert can rely on it
type FeedItem = SourceFeedItem & { source_id?: number | null };

// Exact shape we send to upsertArticle
type UpsertInput = {
  sourceId: number;
  source_id: number;
  title: string;
  link: string;
  author: string | null;
  publishedAt: string | null; // ISO string or null
  debug: boolean;
  jobId?: string;
  sport?: string | null;
};

// Tolerate both string and object return styles from upsertArticle
type UpsertResult =
  | "inserted"
  | "updated"
  | {
      inserted?: boolean;
      updated?: boolean;
    };

/* ---------- helpers ---------- */

function blockedByDenylist(
  title: string,
  link: string
): { blocked: boolean; reason?: string } {
  let host = "";
  let path = "";
  try {
    const u = new URL(link);
    host = u.hostname.toLowerCase();
    path = (u.pathname + u.search).toLowerCase();
  } catch {
    // bad URL? let other guards handle it
  }
  const text = `${title} ${decodeURIComponent(path)}`.toLowerCase();

  // Domains to always skip (non-NFL heavy or irrelevant)
  const DOMAIN_DENY = new Set<string>([
    "bbc.com",
    "onefootball.com",
    "mlb.com",
    "nhl.com",
    "nba.com",
    "thehockeynews.com",
    "mmajunkie.usatoday.com",
    "ufc.com",
    "golfdigest.com",
  ]);
  if (
    host &&
    Array.from(DOMAIN_DENY).some((d) => host === d || host.endsWith(`.${d}`))
  ) {
    return { blocked: true, reason: "deny-domain" };
  }

  // Keywords that clearly indicate non-NFL
  const KW_DENY = [
    "boxing",
    "mma",
    "ufc",
    "wrestle",
    "wrestling",
    "bowling",
    "nhl",
    "hockey",
    "mlb",
    "baseball",
    "nba",
    "basketball",
    "premier league",
    "soccer",
    "champions league",
    "mls",
    "laliga",
    "serie a",
    "golf",
    "pga",
    "ryder cup",
    "high school",
    "high-school",
    "highschool",
    "prep",
  ];
  if (KW_DENY.some((k) => text.includes(k))) {
    return { blocked: true, reason: "deny-keyword" };
  }

  return { blocked: false };
}

// Turn Date | string | null | undefined into ISO string or null
function toIsoTimestamp(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** Skip obvious non-article pages (home/section indexes, shallow paths). */
function isLikelyArticleUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const p = url.pathname.replace(/\/+$/, "");
    if (!p || p === "/") return false;

    // obvious hubs
    if (/(^|\/)(articles|index|rankings|tools|podcasts?|videos?)\/?$/.test(p))
      return false;

    // dated URLs like /2025/09/03/..., or any long numeric id in the path
    if (/\/20\d{2}[/-]\d{1,2}(?:[/-]\d{1,2})?\//.test(p)) return true;
    if (/\b\d{4,}\b/.test(p)) return true;

    const parts = p.split("/").filter(Boolean);
    if (parts.length >= 3) return true;

    const last = parts[parts.length - 1] || "";
    if (parts.length >= 2 && /[a-z][-_][a-z]/i.test(last)) return true;

    const sp = url.searchParams;
    if (sp.has("id") || sp.has("storyId") || sp.has("cid")) return true;

    return false;
  } catch {
    return false;
  }
}

async function fetchFeedItems(
  sourceId: number | undefined,
  limit: number,
  method: ProbeMethod | undefined,
  debug: boolean,
  jobId?: string
): Promise<FeedItem[]> {
  if (!sourceId) return [];
  const items = await fetchItemsForSource(sourceId, limit, {
    method, // pass through to force adapter/rss/scrape in the fetcher
    debug,
    jobId,
  });
  return items.map((it) => ({ ...it, source_id: sourceId }));
}

// Keep obvious non-articles out
function isUtilityUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const p = url.pathname.toLowerCase();
    if (p === "/" || p === "") return true; // homepage
    if (p.includes("sitemap")) return true;
    if (p.includes("google-news")) return true;
    if (p.includes("watch") || p.includes("videos")) return true;
    if (p.includes("where-to-watch")) return true;
    return false;
  } catch {
    return true;
  }
}

// local wrapper to give upsertArticle a concrete return type (no `any`)
async function safeUpsert(input: UpsertInput): Promise<UpsertResult> {
  return (await upsertArticle(input)) as unknown as UpsertResult;
}

/* ---------- main ---------- */

export async function* runIngestOnce(
  params: IngestParams
): AsyncGenerator<IngestYield, void, unknown> {
  const { sourceId, limit, debug, method, jobId, sport } = params;

  yield {
    level: "info",
    message: "Fetching candidate items",
    delta: 0,
    meta: { limit, sourceId, sport },
  };

  const feedItems = await fetchFeedItems(sourceId, limit, method, debug, jobId);

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
      if (isUtilityUrl(link) || !isLikelyArticleUrl(link)) {
        if (debug) {
          yield {
            level: "debug",
            message: "Skipped utility/index page",
            delta: 0,
            meta: { link },
          };
        }
        continue;
      }

      // Hard denylist (domains & non-NFL keywords)
      const deny = blockedByDenylist(item.title ?? "", link);
      if (deny.blocked) {
        if (debug) {
          yield {
            level: "debug",
            message: "Skipped by denylist",
            delta: 0,
            meta: { link, reason: deny.reason },
          };
        }
        continue;
      }

      // Content filter
      const allowed = allowItem(
        { title: item.title ?? "", link, description: item.description ?? "" },
        link
      );
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

      // Build typed upsert payload (normalize publishedAt)
      type MaybeDated = { publishedAt?: Date | string | null };
      const upsertInput: UpsertInput = {
        sourceId: (item.source_id ?? sourceId) as number,
        source_id: (item.source_id ?? sourceId) as number,
        title: item.title ?? "",
        link,
        author: item.author ?? null,
        publishedAt: toIsoTimestamp((item as MaybeDated).publishedAt ?? null),
        debug,
        jobId,
        sport: sport ?? null, // thread sport explicitly
      };

      const result = await safeUpsert(upsertInput);

      const isInserted =
        typeof result === "string" ? result === "inserted" : !!result.inserted;

      const isUpdated =
        typeof result === "string" ? result === "updated" : !!result.updated;

      if (isInserted) {
        inserted += 1;
        yield {
          level: "info",
          message: "Inserted article",
          delta: 1,
          meta: { link },
        };
      } else if (isUpdated) {
        updated += 1;
        yield {
          level: "info",
          message: "Updated existing article",
          delta: 0,
          meta: { link },
        };
      } else if (debug) {
        yield {
          level: "debug",
          message: "Upsert returned no change",
          delta: 0,
          meta: { link, result },
        };
      }
    } catch (e: unknown) {
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
