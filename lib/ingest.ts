// lib/ingest.ts
import Parser from "rss-parser";
import { dbQuery } from "@/lib/db";
import { allowItem, classifyLeagueCategory } from "@/lib/contentFilter";
import {
  FALLBACK,
  getSafeImageUrl,
  isWeakArticleImage,
} from "@/lib/images";
import { logIngest, logIngestError } from "@/lib/ingestLogs";
import { SOURCE_ADAPTERS } from "@/lib/sources";
import type { SourceAdapter } from "@/lib/sources/types";
import { normalizeUrl } from "@/lib/sources/shared";

// ✅ new generic adapters (auto-detect)
import { ADAPTERS } from "@/lib/sourceProbe/adapters";

/* ───────────────────────── Types ───────────────────────── */

type SourceRow = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  favicon_url: string | null;
  allowed: boolean | null;
  priority: number | null;
  created_at: string | null;
  category: string | null;
  sport: string | null;
  notes: string | null;
  scrape_path: string | null;
  scrape_selector: string | null;
  paywall: boolean | null;
  scraper_key?: string | null; // explicit adapter key (legacy map)
  adapter_config?: Record<string, unknown> | null; // may include { adapter?: string, pageCount?, daysBack?, limit?, headers? }
  fetch_mode?: "auto" | "rss" | "adapter" | null;
};

type AdapterConfig = {
  limit?: number;
  daysBack?: number;
  pageCount?: number;
  headers?: Record<string, string>;
  adapter?: string; // NEW: allow explicit adapter via config
};

type FeedItem = {
  title: string;
  link: string;                  // normalized absolute URL
  description?: string | null;
  author?: string | null;
  publishedAt?: Date | null;
  imageUrl?: string | null;
};

export type UpsertResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

/* ───────────────────────── Utilities ───────────────────────── */

const parser = new Parser();

// map {title,url,author,publishedAt,imageUrl,description?} → FeedItem
function metaToFeedItem(meta: {
  url: string;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  author?: string | null;
  publishedAt?: string | null | Date;
}): FeedItem {
  const published =
    meta.publishedAt instanceof Date
      ? meta.publishedAt
      : meta.publishedAt
      ? new Date(meta.publishedAt)
      : null;

  return {
    title: (meta.title ?? "").trim(),
    link: normalizeUrl(meta.url),
    description: meta.description ?? null,
    author: meta.author ?? null,
    publishedAt: published && !Number.isNaN(published.valueOf()) ? published : null,
    imageUrl: meta.imageUrl ?? null,
  };
}

async function fetchRssItems(rssUrl: string): Promise<FeedItem[]> {
  const feed = await parser.parseURL(rssUrl);
  const out: FeedItem[] = [];
  for (const it of feed.items) {
    const title = (it.title ?? "").trim();
    const linkRaw = (it.link ?? "").trim();
    const link = linkRaw ? normalizeUrl(linkRaw) : "";
    if (!title || !link) continue;

    const author = (it.creator || it.author || "").trim() || null;
    const description = (it.contentSnippet || it.content || it.summary || "").trim() || null;

    let publishedAt: Date | null = null;
    const iso = (it.isoDate || it.pubDate || "").trim();
    if (iso) {
      const d = new Date(iso);
      if (!Number.isNaN(d.valueOf())) publishedAt = d;
    }

    out.push({
      title,
      link,
      description,
      author,
      publishedAt,
      imageUrl: null,
    });
  }
  return out;
}

/* ---------- Safe keyed-adapter call helpers (strictly typed) ---------- */

type IndexHit = { url: string };

function callGetIndex(
  adapter: SourceAdapter,
  pageCount: number,
  cfg?: AdapterConfig
): Promise<IndexHit[]> {
  const fn = adapter.getIndex as (pages?: number, config?: AdapterConfig) => Promise<IndexHit[]>;
  return typeof cfg === "undefined" ? fn(pageCount) : fn(pageCount, cfg);
}

function callGetArticle(
  adapter: SourceAdapter,
  url: string,
  cfg?: AdapterConfig
): Promise<{ url: string; title: string; description?: string; imageUrl?: string; author?: string; publishedAt?: string }> {
  const fn = adapter.getArticle as (u: string, config?: AdapterConfig) => Promise<{
    url: string; title: string; description?: string; imageUrl?: string; author?: string; publishedAt?: string;
  }>;
  return typeof cfg === "undefined" ? fn(url) : fn(url, cfg);
}

async function fetchKeyedAdapterItems(
  adapter: SourceAdapter,
  pageCount: number,
  cfg?: AdapterConfig
): Promise<FeedItem[]> {
  const hits = await callGetIndex(adapter, pageCount, cfg);
  const items: FeedItem[] = [];
  for (const h of hits) {
    try {
      const meta = await callGetArticle(adapter, normalizeUrl(h.url), cfg);
      items.push(metaToFeedItem(meta));
    } catch {
      /* skip bad URL and continue */
    }
  }
  return items;
}

/* ---------- Generic auto-detect adapters (from Probe) ---------- */

type ProbeArticle = {
  title: string;
  url: string;
  author?: string | null;
  publishedAt?: string | null;
  imageUrl?: string | null;
  // may include description on some adapters
  description?: string | null;
};

async function tryGenericAdapters(base: URL): Promise<FeedItem[] | null> {
  // run the first matching adapter that yields items
  for (const a of ADAPTERS.filter(ad => {
    try { return ad.match(base); } catch { return false; }
  })) {
    try {
      // probePreview returns OG-enriched article metas
      const arts: ProbeArticle[] = await a.probePreview(base);
      if (arts && arts.length) {
        const mapped = arts.map(ar =>
          metaToFeedItem({
            url: ar.url,
            title: ar.title,
            description: ar.description ?? undefined,
            imageUrl: ar.imageUrl ?? undefined,
            author: ar.author ?? undefined,
            publishedAt: ar.publishedAt ?? undefined,
          })
        );
        return mapped;
      }
    } catch {
      // continue to next matching adapter
    }
  }
  return null;
}

/* ---------- Candidate collection (RSS → keyed adapter → generic) ---------- */

function daysBackCutoff(daysBack?: number): Date | null {
  if (!daysBack || daysBack <= 0) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Math.floor(daysBack));
  return d;
}

/** Decide how to fetch items for a source (rss, keyed adapter, or generic adapters). */
async function getCandidateItems(
  src: SourceRow
): Promise<{ items: FeedItem[]; via: "rss" | "adapter" | "none" }> {
  const mode: "auto" | "rss" | "adapter" =
    (src.fetch_mode as "auto" | "rss" | "adapter") || "auto";

  const cfg = (src.adapter_config ?? {}) as AdapterConfig;
  const pageCount = typeof cfg.pageCount === "number" && cfg.pageCount > 0 ? cfg.pageCount : 2;
  const limit = typeof cfg.limit === "number" && cfg.limit > 0 ? cfg.limit : undefined;
  const cutoff = daysBackCutoff(cfg.daysBack);

  // explicit adapter key (priority 1): adapter_config.adapter > scraper_key (legacy)
  const explicitKey =
    (cfg.adapter || "").trim().toLowerCase() ||
    (src.scraper_key || "").trim().toLowerCase();

  // base URL for generic adapter matching
  let base: URL | null = null;
  try {
    const raw =
      (src.homepage_url && src.homepage_url.trim()) ||
      (src.rss_url && new URL(src.rss_url).origin) ||
      "";
    base = raw ? new URL(raw) : null;
  } catch {
    base = null;
  }

  const applyPostFilters = (list: FeedItem[]): FeedItem[] => {
    let out = list;
    if (cutoff) {
      out = out.filter(i => !i.publishedAt || i.publishedAt >= cutoff);
    }
    if (limit) {
      out = out.slice(0, limit);
    }
    return out;
  };

  const tryRss = async (): Promise<FeedItem[] | null> => {
    if (!src.rss_url || src.rss_url.trim().length === 0) return null;
    try {
      const items = await fetchRssItems(src.rss_url.trim());
      return applyPostFilters(items);
    } catch (err) {
      await logIngestError({
        sourceId: src.id,
        reason: "fetch_error",
        detail: (err as Error).message,
        url: src.rss_url ?? undefined,
        domain: src.homepage_url ?? undefined,
      });
      return null;
    }
  };

  const tryKeyed = async (): Promise<FeedItem[] | null> => {
    const adapter = explicitKey ? SOURCE_ADAPTERS[explicitKey] : undefined;
    if (!adapter) return null;
    try {
      const items = await fetchKeyedAdapterItems(adapter, pageCount, cfg);
      return applyPostFilters(items);
    } catch (err) {
      await logIngestError({
        sourceId: src.id,
        reason: "fetch_error",
        detail: (err as Error).message,
        url: src.homepage_url ?? undefined,
      });
      return null;
    }
  };

  const tryGeneric = async (): Promise<FeedItem[] | null> => {
    if (!base) return null;
    try {
      const items = await tryGenericAdapters(base);
      return items ? applyPostFilters(items) : null;
    } catch {
      return null;
    }
  };

  // explicit fetch_mode routing
  if (mode === "rss") {
    const items = await tryRss();
    return { items: items ?? [], via: items ? "rss" : "none" };
  }

  if (mode === "adapter") {
    // prefer explicit keyed adapter if present; else generic
    const keyed = await tryKeyed();
    if (keyed && keyed.length) return { items: keyed, via: "adapter" };
    const generic = await tryGeneric();
    return { items: generic ?? [], via: generic ? "adapter" : "none" };
  }

  // mode === "auto"
  const rssItems = await tryRss();
  if (rssItems && rssItems.length > 0) return { items: rssItems, via: "rss" };

  // then explicit keyed adapter
  const keyedItems = await tryKeyed();
  if (keyedItems && keyedItems.length > 0) return { items: keyedItems, via: "adapter" };

  // finally generic detection
  const genericItems = await tryGeneric();
  if (genericItems && genericItems.length > 0) return { items: genericItems, via: "adapter" };

  return { items: [], via: "none" };
}

/** Image hygiene & fallback seeding. */
async function cleanImage(
  url: string | null
): Promise<{ imageUrl: string | null; seededPlayer?: string | null }> {
  if (!url) return { imageUrl: null, seededPlayer: null };
  const safe = await getSafeImageUrl(url);
  if (!safe || isWeakArticleImage(safe)) {
    return { imageUrl: FALLBACK, seededPlayer: null };
  }
  return { imageUrl: safe, seededPlayer: null };
}

/** Upsert article — matches your `articles` schema. */
async function upsertArticle(
  sourceId: number,
  item: FeedItem,
  sport: string | null
): Promise<"inserted" | "updated" | "skipped"> {
  const normalizedLink = normalizeUrl(item.link);
  const published = item.publishedAt ? item.publishedAt.toISOString() : null;

  let domain: string | null = null;
  try {
    domain = new URL(normalizedLink).hostname;
  } catch {
    domain = null;
  }

  const sql = `
    insert into articles (
      source_id, title, canonical_url, url, author, published_at, discovered_at,
      summary, image_url, sport, domain
    )
    values (
      $1,$2,$3,$4,$5,$6, now(),
      $7,$8,$9,$10
    )
    on conflict (canonical_url)
    do update set
      title        = excluded.title,
      url          = excluded.url,
      author       = excluded.author,
      published_at = coalesce(excluded.published_at, articles.published_at),
      summary      = excluded.summary,
      image_url    = excluded.image_url,
      sport        = coalesce(excluded.sport, articles.sport),
      domain       = excluded.domain
    returning (xmax = 0) as inserted
  `;
  const params = [
    sourceId,
    item.title,
    normalizedLink,
    normalizedLink,
    item.author ?? null,
    published,
    item.description ?? null,
    item.imageUrl ?? null,
    sport,
    domain,
  ];

  const result = await dbQuery<{ inserted: boolean }>(sql, params);
  const flag = result.rows[0]?.inserted;
  if (flag === true) return "inserted";
  if (flag === false) return "updated";
  return "skipped";
}

/* ───────────────────────── Main entry (unchanged) ───────────────────────── */

export async function ingestSourceById(sourceId: number): Promise<UpsertResult> {
  const one = await dbQuery<SourceRow>("select * from sources where id = $1", [Number(sourceId)]);
  const src = one.rows[0];
  if (!src) throw new Error(`Source ${sourceId} not found`);

  const { items, via } = await getCandidateItems(src);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  if (items.length === 0) {
    await logIngest({
      sourceId,
      reason: "scrape_no_matches",
      detail: `No items (via=${via})`,
    });
    return { inserted, updated, skipped };
  }

  const seenCanonicals = new Set<string>();

  for (const raw of items) {
    try {
      const canonical = normalizeUrl(raw.link);
      if (seenCanonicals.has(canonical)) {
        skipped++;
        continue;
      }
      seenCanonicals.add(canonical);

      const feedLike = {
        title: raw.title,
        link: raw.link,
        description: raw.description ?? null,
      };

      if (!allowItem(feedLike, feedLike.link)) {
        skipped++;
        continue;
      }

      const cls = classifyLeagueCategory(feedLike) as {
        league?: string | null;
        category?: string | null;
      };
      const sportStr: string | null = cls?.league ?? null;

      const cleaned = await cleanImage(raw.imageUrl ?? null);
      const item: FeedItem = { ...raw, imageUrl: cleaned.imageUrl };

      const res = await upsertArticle(src.id, item, sportStr);
      if (res === "inserted") inserted++;
      else if (res === "updated") updated++;
      else skipped++;
    } catch (err) {
      skipped++;
      await logIngestError({
        sourceId: src.id,
        reason: "parse_error",
        detail: (err as Error).message,
        url: raw.link,
        title: raw.title,
      });
    }
  }

  await logIngest({
    sourceId: src.id,
    reason: "ok_update",
    detail: `via=${via}; total=${items.length}; inserted=${inserted}; updated=${updated}; skipped=${skipped}`,
  });

  return { inserted, updated, skipped };
}

/** Batch ingest all allowed sources. */
export async function ingestAllAllowedSources(): Promise<
  Array<{ source_id: number; result: UpsertResult }>
> {
  const list = await dbQuery<SourceRow>(
    `select * from sources
       where coalesce(allowed, true) = true
       order by coalesce(priority, 999), id`,
    []
  );

  const results: Array<{ source_id: number; result: UpsertResult }> = [];

  for (const src of list.rows) {
    try {
      const res = await ingestSourceById(src.id);
      results.push({ source_id: src.id, result: res });
    } catch (err) {
      await logIngestError({
        sourceId: src.id,
        reason: "fetch_error",
        detail: (err as Error).message,
      });
      results.push({ source_id: src.id, result: { inserted: 0, updated: 0, skipped: 0 } });
    }
  }

  return results;
}

// ✅ compatibility export for older callers
export async function ingestAllSources(limit?: number) {
  const all = await ingestAllAllowedSources();
  return typeof limit === "number" && limit > 0 ? all.slice(0, limit) : all;
}
