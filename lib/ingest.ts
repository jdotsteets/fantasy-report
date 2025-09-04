// lib/ingest.ts
// Drop-in ingest orchestrator with Job logging & progress.
// Uses adapters when present, but Job UI works even without them.

import { dbQuery } from "@/lib/db";
import {
  appendEvent,
  setProgress,
  finishJobSuccess,
  failJob,
  type JobEventLevel,
} from "@/lib/jobs";

// ─────────────────────────────────────────────────────────────────────────────
// Optional adapters (loaded at runtime)
// ─────────────────────────────────────────────────────────────────────────────

type Adapters = {
  parseFeedItems?: (sourceId: number, limit?: number) => Promise<any[]>;
  extractCanonicalUrl?: (url: string, html?: string) => Promise<string | null>;
  scrapeArticle?: (
    url: string
  ) => Promise<Partial<ArticleInput> & { canonical_url?: string | null }>;
  routeByUrl?: (
    url: string
  ) => Promise<{ kind: "article" | "index" | "skip"; reason?: string; section?: string }>;
};

async function loadAdapters(): Promise<Adapters> {
  let helpers: any = {};
  let adapters: any = {};
  try { helpers = await import("./sources/helpers"); } catch {}
  try { adapters = await import("./sources/adapters"); } catch {}

  return {
    parseFeedItems: adapters?.parseFeedItems,
    extractCanonicalUrl: helpers?.extractCanonicalUrl ?? adapters?.extractCanonicalUrl,
    scrapeArticle: adapters?.scrapeArticle,
    routeByUrl: helpers?.routeByUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job-aware logger
// ─────────────────────────────────────────────────────────────────────────────

function mkLogger(jobId?: string) {
  const send = async (level: JobEventLevel, message: string, meta?: Record<string, unknown>) => {
    if (!jobId) return;
    try { await appendEvent(jobId, level, message, (meta ?? null) as any); } catch {}
  };
  return {
    info: (m: string, meta?: Record<string, unknown>) => send("info", m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => send("warn", m, meta),
    error: (m: string, meta?: Record<string, unknown>) => send("error", m, meta),
    debug: (m: string, meta?: Record<string, unknown>) => send("debug", m, meta),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers (match your articles schema)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Columns present in your table (from your screenshot):
 * id, source_id, url, canonical_url, title, author, published_at, discovered_at,
 * summary, image_url, topics, players, sport, season, week, score, domain,
 * slug, fingerprint, cleaned_title, popularity_score, popularity, tsv,
 * image_source, image_checked_at, primary_topic, is_player_page, secondary_topic,
 * is_static, static_type
 */
export type ArticleInput = {
  canonical_url?: string | null;
  url?: string | null;
  // convenience alias some callers may use
  link?: string | null;
  source_id?: number | null;
  title?: string | null;
  author?: string | null;
  published_at?: Date | string | null;
  image_url?: string | null;
  domain?: string | null;
  sport?: string | null;
};



// Keep the same ArticleInput/UpsertResult types you already have



// Keep/adjust this type to your liking; the function is liberal in what it accepts

export type UpsertResult = { inserted: boolean };

function pickNonEmpty(...vals: Array<unknown>): string | null {
  for (const v of vals) {
    if (typeof v === "string") {
      const s = v.trim();
      if (s) return s;
    }
  }
  return null;
}

export async function upsertArticle(row: ArticleInput): Promise<UpsertResult> {
  // Be very defensive about URL fields
  const primary = pickNonEmpty(row.canonical_url, row.url, row.link);
  if (!primary) {
    // Nothing to do; treat as skipped
    return { inserted: false };
  }
  const canonical = pickNonEmpty(row.canonical_url, primary)!;
  const url = pickNonEmpty(row.url, primary)!;

  // Normalize published_at if given as string
  let publishedAt: Date | null = null;
  if (row.published_at) {
    const d = new Date(row.published_at as any);
    publishedAt = Number.isNaN(d.valueOf()) ? null : d;
  }

  const params = [
    canonical,                       // $1
    url,                             // $2
    row.source_id ?? null,           // $3
    row.title ?? null,               // $4
    row.author ?? null,              // $5
    publishedAt,                     // $6
    row.image_url ?? null,           // $7
    row.domain ?? null,              // $8
    row.sport ?? null,               // $9
  ];

  const sql = `
    INSERT INTO articles (
      canonical_url,
      url,
      source_id,
      title,
      author,
      published_at,
      image_url,
      domain,
      sport,
      discovered_at
    ) VALUES (
      $1::text,
      $2::text,
      $3::int,
      NULLIF($4::text, ''),
      NULLIF($5::text, ''),
      $6::timestamptz,
      NULLIF($7::text, ''),
      NULLIF($8::text, ''),
      NULLIF($9::text, ''),
      NOW()
    )
    ON CONFLICT (canonical_url)
    DO UPDATE SET
      url          = COALESCE(EXCLUDED.url, articles.url),
      title        = COALESCE(EXCLUDED.title, articles.title),
      author       = COALESCE(EXCLUDED.author, articles.author),
      published_at = COALESCE(EXCLUDED.published_at, articles.published_at),
      image_url    = COALESCE(EXCLUDED.image_url, articles.image_url),
      domain       = COALESCE(EXCLUDED.domain, articles.domain),
      sport        = COALESCE(EXCLUDED.sport, articles.sport)
    RETURNING (xmax = 0) AS inserted;
  `;

  const res = await dbQuery<{ inserted: boolean }>(sql, params);
  const rows = (Array.isArray(res) ? res : (res as any).rows) as { inserted: boolean }[];
  return { inserted: !!rows?.[0]?.inserted };
}


// ─────────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────────

type SourceRow = {
  id: number;
  slug: string | null;
  site?: string | null;     // optional metadata you store about the source
  allowed?: boolean | null;
  feed_url?: string | null;
  base_url?: string | null;
};

export async function getSource(sourceId: number): Promise<SourceRow | null> {
  const res = await dbQuery<SourceRow>(
    "SELECT id, slug, site, allowed, feed_url, base_url FROM sources WHERE id=$1",
    [sourceId]
  );
  const rows = (Array.isArray(res) ? res : (res as any).rows) as SourceRow[];
  return rows?.[0] ?? null;
}

export async function getAllowedSources(): Promise<SourceRow[]> {
  const res = await dbQuery<SourceRow>(
    "SELECT id, slug, site, allowed, feed_url, base_url FROM sources WHERE COALESCE(allowed, true) = true ORDER BY id ASC",
    []
  );
  const rows = (Array.isArray(res) ? res : (res as any).rows) as SourceRow[];
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingest core
// ─────────────────────────────────────────────────────────────────────────────

type IngestSummary = {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
};

function hostnameOf(url: string | null | undefined) {
  try { return url ? new URL(url).hostname : null; } catch { return null; }
}

function isLikelyIndexOrNonArticle(url: string) {
  const u = url.toLowerCase();
  return (
    u.includes("sitemap") ||
    u.endsWith("/videos") ||
    u.includes("/video/") ||
    u.includes("/category/") ||
    (u.endsWith("/") && u.split("/").filter(Boolean).length <= 2)
  );
}

export async function ingestSourceById(
  sourceId: number,
  opts?: { jobId?: string; limit?: number }
): Promise<IngestSummary> {
  const jobId = opts?.jobId;
  const limit = opts?.limit ?? 200;

  const log = mkLogger(jobId);
  const adapters = await loadAdapters();

  const src = await getSource(sourceId);
  if (!src) {
    await log.error("Unknown source", { sourceId });
    throw new Error(`Source ${sourceId} not found`);
  }

  await log.info("Ingest started", { sourceId, limit });
  if (jobId) { try { await setProgress(jobId, 0, limit); } catch {} }

  // 1) Candidate items
  await log.info("Fetching candidate items", { sourceId, limit });
  let items: any[] = [];
  try {
    items = adapters.parseFeedItems ? await adapters.parseFeedItems(sourceId, limit) : [];
  } catch (err: any) {
    await log.error("Failed to fetch candidates", { sourceId, error: String(err?.message ?? err) });
  }

  await log.debug("Fetched feed items", { count: items.length });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let processed = 0;

  for (const feedLike of items) {
    processed++;
    if (jobId) { try { await setProgress(jobId, processed); } catch {} }

    const link: string = String(feedLike?.link ?? "");
    if (!link) { skipped++; continue; }

    // Optional routing (article vs index)
    try {
      if (adapters.routeByUrl) {
        const routed = await adapters.routeByUrl(link);
        if (routed?.kind === "skip") {
          skipped++;
          await log.debug("Skipped non-article/index page", { link });
          continue;
        }
        if (routed?.kind === "index") {
          skipped++;
          await log.debug("Skipped index/section page", { link, reason: routed?.reason, section: routed?.section });
          continue;
        }
      } else if (isLikelyIndexOrNonArticle(link)) {
        skipped++;
        await log.debug("Skipped non-article/index page", { link });
        continue;
      }
    } catch {
      // routing is best-effort
    }

    // 2) Basic fields
    let canonical = link;
    let title: string | null = feedLike?.title ?? null;
    let publishedAt: Date | null = null;

    const p = feedLike?.publishedAt ?? feedLike?.pubDate ?? feedLike?.isoDate;
    if (typeof p === "string" || p instanceof Date) {
      const dt = new Date(p as any);
      if (!Number.isNaN(dt.valueOf())) publishedAt = dt;
    }

    // 3) Scrape (optional)
    try {
      if (adapters.scrapeArticle) {
        const scraped = await adapters.scrapeArticle(link);
        if (scraped?.canonical_url) canonical = scraped.canonical_url!;
        title = (scraped.title ?? title ?? null) as any;
        publishedAt = (scraped.published_at ?? publishedAt ?? null) as any;

        const res = await upsertArticle({
          canonical_url: canonical,
          url: scraped.url ?? link,
          source_id: sourceId,
          title,
          author: (scraped.author as any) ?? null,
          published_at: publishedAt,
          image_url: (scraped.image_url as any) ?? null,
          domain: hostnameOf(scraped.url ?? link) ?? null,
          sport: null, // set "nfl" here if you want to persist the sport
        });
        if (res.inserted) inserted++; else updated++;
        continue;
      }
    } catch (err: any) {
      await log.warn("Scrape failed; falling back to basic upsert", { link, error: String(err?.message ?? err) });
    }

    // 4) Fallback upsert with feed data
    const res = await upsertArticle({
      canonical_url: canonical,
      url: link,
      source_id: sourceId,
      title,
      author: null,
      published_at: publishedAt,
      image_url: null,
      domain: hostnameOf(link),
      sport: null,
    });
    if (res.inserted) inserted++; else updated++;
  }

  const summary = { total: items.length, inserted, updated, skipped };
  await log.info("Ingest summary", summary);
  return summary;
}

export async function ingestAllAllowedSources(
  opts?: { jobId?: string; perSourceLimit?: number }
): Promise<void> {
  const jobId = opts?.jobId;
  const perSourceLimit = opts?.perSourceLimit ?? 50;
  const log = mkLogger(jobId);

  const sources = await getAllowedSources();
  await log.info("Starting ingest for allowed sources", { count: sources.length, perSourceLimit });

  if (jobId) { try { await setProgress(jobId, 0, sources.length); } catch {} }
  let done = 0;
  for (const s of sources) {
    await log.info("Ingesting source", { sourceId: s.id, slug: s.slug });
    try {
      await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
    } catch (err: any) {
      await log.error("Source ingest failed", { sourceId: s.id, error: String(err?.message ?? err) });
    }
    done++;
    if (jobId) { try { await setProgress(jobId, done); } catch {} }
  }

  await log.info("All allowed sources finished", { count: sources.length });
}

export async function ingestAllSources(
  opts?: { jobId?: string; perSourceLimit?: number }
): Promise<void> {
  const jobId = opts?.jobId;
  const perSourceLimit = opts?.perSourceLimit ?? 50;
  const log = mkLogger(jobId);

  const res = await dbQuery<SourceRow>(
    "SELECT id, slug, site, allowed, feed_url, base_url FROM sources ORDER BY id ASC",
    []
  );
  const rows = (Array.isArray(res) ? res : (res as any).rows) as SourceRow[];

  await log.info("Starting ingest for all sources", { count: rows.length, perSourceLimit });

  if (jobId) { try { await setProgress(jobId, 0, rows.length); } catch {} }
  let done = 0;
  for (const s of rows) {
    await log.info("Ingesting source", { sourceId: s.id, slug: s.slug });
    try {
      await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
    } catch (err: any) {
      await log.error("Source ingest failed", { sourceId: s.id, error: String(err?.message ?? err) });
    }
    done++;
    if (jobId) { try { await setProgress(jobId, done); } catch {} }
  }

  await log.info("All sources finished", { count: rows.length });
}

// ─────────────────────────────────────────────────────────────────────────────
// Job wrappers (optional)
// ─────────────────────────────────────────────────────────────────────────────

export async function runSingleSourceIngestWithJob(sourceId: number, limit = 200) {
  const { createJob } = await import("@/lib/jobs");
  const job = await createJob("ingest", { sourceId, limit });
  try {
    const summary = await ingestSourceById(sourceId, { jobId: job.id, limit });
    await finishJobSuccess(job.id, "success");
    return { jobId: job.id, summary };
  } catch (err: any) {
    await failJob(job.id, String(err?.message ?? err));
    throw err;
  }
}

export async function runAllAllowedSourcesIngestWithJob(perSourceLimit = 50) {
  const { createJob } = await import("@/lib/jobs");
  const job = await createJob("ingest", { scope: "allowed", perSourceLimit });
  try {
    await ingestAllAllowedSources({ jobId: job.id, perSourceLimit });
    await finishJobSuccess(job.id, "success");
    return { jobId: job.id };
  } catch (err: any) {
    await failJob(job.id, String(err?.message ?? err));
    throw err;
  }
}
