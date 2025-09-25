// lib/ingestRunner.ts
import { allowItem } from "@/lib/contentFilter";
import { upsertArticle } from "@/lib/ingest";
import { fetchItemsForSource } from "./sources";
import type { FeedItem as SourceFeedItem, ProbeMethod } from "./sources/types";
import {
  logIngest,
  logIngestStart,
  logIngestFinish,
} from "@/lib/ingestLogs";

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
  if (!u) return false;

  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }

  // http(s) only
  if (!/^https?:$/i.test(url.protocol)) return false;

  // normalize (don’t let fragments/params confuse path checks)
  url.hash = "";
  const pRaw = url.pathname || "/";
  const p = pRaw.replace(/\/+$/, ""); // strip trailing /
  if (!p || p === "/") return false;

  const host = url.hostname.replace(/^www\./i, "");
  const segs = p.split("/").filter(Boolean);
  const last = (segs[segs.length - 1] || "").replace(/\.(html?|php|asp|aspx)$/i, "");

  // --- hard rejects (obvious non-article sections) ---
  if (
    /(\/|^)(articles|index|rankings|tools|tag|tags|category|categories|author|team|teams|topic|topics|series|search|videos?|podcasts?|podcast|shop|about|contact|privacy|terms)(\/|$)/i
      .test(p)
  ) return false;

  // archive pagination like /page/2/
  if (/(^|\/)page\/\d+(\/|$)/i.test(p)) return false;

  // generic file tails that aren’t articles
  if (/^(|index|feed|rss|json|xml)$/i.test(last)) return false;

  // --- strong accepts (quick paths to true) ---
  // dated URLs like /2025/09/03/... or /2025/09/...
  if (/\/20\d{2}[/-]\d{1,2}(?:[/-]\d{1,2})?\//.test(p)) return true;

  // any long numeric id in the path
  if (/\b\d{4,}\b/.test(p)) return true;

  // your original “enough depth” heuristic
  if (segs.length >= 3) return true;

  // your original “hyphen/underscore in last segment with >=2 segments”
  if (segs.length >= 2 && /[a-z][-_][a-z]/i.test(last)) return true;

  // query param ids (common CMSes)
  const sp = url.searchParams;
  if (sp.has("id") || sp.has("storyId") || sp.has("cid")) return true;

  // --- slug-based accepts (WordPress & friends) ---
  // multi-word hyphenated slug: ≥3 words and ≥12 chars total
  const words = last.split(/[-_]+/).filter(Boolean);
  if (words.length >= 3 && last.length >= 12) return true;

  // site-specific loosener for football.razzball.com (clean, dashed slugs)
  if (
    host === "football.razzball.com" &&
    /^[a-z0-9-]+$/i.test(last) &&
    /-/.test(last) &&
    last.length >= 10
  ) return true;

  // fallback: single long dashed token like "rankings-week-4"
  if (/^[a-z0-9-]{16,}$/i.test(last) && /-/.test(last)) return true;

  return false;
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

function hostFromUrl(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/* ---------- main ---------- */

export async function* runIngestOnce(
  params: IngestParams
): AsyncGenerator<IngestYield, void, unknown> {
  const { sourceId, limit, debug, method, jobId, sport } = params;

  if (sourceId) {
    await logIngestStart(sourceId, jobId ?? null);
  }

  yield {
    level: "info",
    message: "Fetching candidate items",
    delta: 0,
    meta: { limit, sourceId, sport, method },
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
    const title = item.title ?? "";
    const domain = hostFromUrl(link);

    // Log discovery of each candidate before filters
    if (sourceId) {
      await logIngest({
        sourceId,
        url: link || null,
        title: title || null,
        domain,
        reason: "ok_insert", // maps to event 'discover'
        detail: method ? `candidate via ${method}` : "candidate",
        jobId: jobId ?? null,
      });
    }

    try {
      // Utility / index pages
      if (isUtilityUrl(link)) {
        if (sourceId) {
          await logIngest({
            sourceId,
            url: link || null,
            title: title || null,
            domain,
            reason: "filtered_out", // maps to 'skip'
            detail: "utility",
            jobId: jobId ?? null,
          });
        }
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

      if (!isLikelyArticleUrl(link)) {
        if (sourceId) {
          await logIngest({
            sourceId,
            url: link || null,
            title: title || null,
            domain,
            reason: "filtered_out",
            detail: "not_article",
            jobId: jobId ?? null,
          });
        }
        if (debug) {
          yield {
            level: "debug",
            message: "Skipped non-article URL",
            delta: 0,
            meta: { link },
          };
        }
        continue;
      }

      // Hard denylist (domains & non-NFL keywords)
      const deny = blockedByDenylist(title, link);
      if (deny.blocked) {
        if (sourceId) {
          await logIngest({
            sourceId,
            url: link || null,
            title: title || null,
            domain,
            reason: "filtered_out",
            detail: deny.reason ?? "denylist",
            jobId: jobId ?? null,
          });
        }
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
        { title, link, description: item.description ?? "" },
        link
      );
      if (!allowed) {
        if (sourceId) {
          await logIngest({
            sourceId,
            url: link || null,
            title: title || null,
            domain,
            reason: "blocked_by_filter",
            detail: "content_filter",
            jobId: jobId ?? null,
          });
        }
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
        title,
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

        if (sourceId) {
          await logIngest({
            sourceId,
            url: link,
            title,
            domain,
            reason: "upsert_inserted", // maps to 'upsert'
            detail: method ? `via ${method}` : null,
            jobId: jobId ?? null,
          });
        }

        yield {
          level: "info",
          message: "Inserted article",
          delta: 1,
          meta: { link },
        };
      } else if (isUpdated) {
        updated += 1;

        if (sourceId) {
          await logIngest({
            sourceId,
            url: link,
            title,
            domain,
            reason: "upsert_updated",
            detail: method ? `via ${method}` : null,
            jobId: jobId ?? null,
          });
        }

        yield {
          level: "info",
          message: "Updated existing article",
          delta: 0,
          meta: { link },
        };
      } else {
        if (sourceId) {
          await logIngest({
            sourceId,
            url: link,
            title,
            domain,
            reason: "upsert_skipped",
            detail: "no_change",
            jobId: jobId ?? null,
          });
        }

        if (debug) {
          yield {
            level: "debug",
            message: "Upsert returned no change",
            delta: 0,
            meta: { link, result },
          };
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);

      if (sourceId) {
        await logIngest({
          sourceId,
          url: link || null,
          title: title || null,
          domain,
          reason: "invalid_item",
          detail: msg,
          jobId: jobId ?? null,
          // event/level inferred as "error" by logger
        });
      }

      yield {
        level: "error",
        message: "Insert failed",
        delta: 0,
        meta: { error: msg, link },
      };
    }
  }

  if (sourceId) {
    await logIngestFinish(sourceId, jobId ?? null);
  }

  yield {
    level: "info",
    message: "Ingest summary",
    delta: 0,
    meta: { total: feedItems.length, inserted, updated },
  };
}
