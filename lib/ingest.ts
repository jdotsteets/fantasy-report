// lib/ingest.ts
// Ingest orchestrator + per-item ingest_logs, integrated with classify.ts.

import { dbQuery } from "@/lib/db";
import {
  appendEvent,
  setProgress,
  finishJobSuccess,
  failJob,
  type JobEventLevel,
} from "@/lib/jobs";

import { fetchItemsForSource } from "@/lib/sources/index";
import { classifyArticle } from "@/lib/classify";

// ─────────────────────────────────────────────────────────────────────────────
// Optional helpers/adapters (scrape canonical, route, etc.)
// ─────────────────────────────────────────────────────────────────────────────
type Adapters = {
  extractCanonicalUrl?: (url: string, html?: string) => Promise<string | null>;
  scrapeArticle?: (
    url: string
  ) => Promise<
    Partial<ArticleInput> & {
      canonical_url?: string | null;
      summary?: string | null;
    }
  >;
  routeByUrl?: (
    url: string
  ) => Promise<{ kind: "article" | "index" | "skip"; reason?: string; section?: string }>;
};

async function loadAdapters(): Promise<Adapters> {
  let helpers: any = {};
  let adapters: any = {};
  try {
    helpers = await import("./sources/helpers");
  } catch {}
  try {
    adapters = await import("./sources/adapters");
  } catch {}
  return {
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
    try {
      await appendEvent(jobId, level, message, (meta ?? null) as any);
    } catch {}
  };
  return {
    info: (m: string, meta?: Record<string, unknown>) => send("info", m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => send("warn", m, meta),
    error: (m: string, meta?: Record<string, unknown>) => send("error", m, meta),
    debug: (m: string, meta?: Record<string, unknown>) => send("debug", m, meta),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers (articles)
// Columns (per your schema):
// id, source_id, url, canonical_url, title, author, published_at, discovered_at,
// summary, image_url, topics, players, sport, season, week, score, domain,
// slug, fingerprint, cleaned_title, popularity_score, popularity, tsv,
// image_source, image_checked_at, primary_topic, is_player_page, secondary_topic,
// is_static, static_type
// ─────────────────────────────────────────────────────────────────────────────
export type ArticleInput = {
  canonical_url?: string | null;
  url?: string | null;
  link?: string | null; // convenience alias
  source_id?: number | null;
  title?: string | null;
  author?: string | null;
  published_at?: Date | string | null;
  image_url?: string | null;
  domain?: string | null;
  sport?: string | null;
  // classification fields
  topics?: string[] | null;
  primary_topic?: string | null;
  secondary_topic?: string | null;
  week?: number | null;
};

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
  const primary = pickNonEmpty(row.canonical_url, row.url, row.link);
  if (!primary) return { inserted: false };

  const canonical = pickNonEmpty(row.canonical_url, primary)!;
  const url = pickNonEmpty(row.url, primary)!;

  let publishedAt: Date | null = null;
  if (row.published_at) {
    const d = new Date(row.published_at as any);
    publishedAt = Number.isNaN(d.valueOf()) ? null : d;
  }

  const topicsArr = Array.isArray(row.topics) ? row.topics : null;

  const params = [
    canonical, // $1
    url, // $2
    row.source_id ?? null, // $3
    row.title ?? null, // $4
    row.author ?? null, // $5
    publishedAt, // $6
    row.image_url ?? null, // $7
    row.domain ?? null, // $8
    (row.sport ?? "nfl") || null, // $9
    topicsArr, // $10 ::text[]
    row.primary_topic ?? null, // $11
    row.secondary_topic ?? null, // $12
    row.week ?? null, // $13 ::int
  ];

  const sql = `
    INSERT INTO articles (
      canonical_url, url, source_id, title, author, published_at,
      image_url, domain, sport, discovered_at,
      topics, primary_topic, secondary_topic, week
    ) VALUES (
      $1::text, $2::text, $3::int,
      NULLIF($4::text,''), NULLIF($5::text,''),
      $6::timestamptz,
      NULLIF($7::text,''), NULLIF($8::text,''), NULLIF($9::text,''),
      NOW(),
      $10::text[], NULLIF($11::text,''), NULLIF($12::text,''), $13::int
    )
    ON CONFLICT (canonical_url)
    DO UPDATE SET
      url            = COALESCE(EXCLUDED.url, articles.url),
      title          = COALESCE(EXCLUDED.title, articles.title),
      author         = COALESCE(EXCLUDED.author, articles.author),
      published_at   = COALESCE(EXCLUDED.published_at, articles.published_at),
      image_url      = COALESCE(EXCLUDED.image_url, articles.image_url),
      domain         = COALESCE(EXCLUDED.domain, articles.domain),
      sport          = COALESCE(EXCLUDED.sport, articles.sport),
      topics         = COALESCE(EXCLUDED.topics, articles.topics),
      primary_topic  = COALESCE(EXCLUDED.primary_topic, articles.primary_topic),
      secondary_topic= COALESCE(EXCLUDED.secondary_topic, articles.secondary_topic),
      week           = COALESCE(EXCLUDED.week, articles.week)
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
  name: string | null;
  allowed: boolean | null;
  rss_url?: string | null;
  homepage_url?: string | null;
  scrape_selector?: string | null;
};

export async function getSource(sourceId: number): Promise<SourceRow | null> {
  const res = await dbQuery<SourceRow>(
    `SELECT id, name, allowed, rss_url, homepage_url, scrape_selector
     FROM sources WHERE id=$1`,
    [sourceId]
  );
  const rows = (Array.isArray(res) ? res : (res as any).rows) as SourceRow[];
  return rows?.[0] ?? null;
}

export async function getAllowedSources(): Promise<SourceRow[]> {
  const res = await dbQuery<SourceRow>(
    `SELECT id, name, allowed, rss_url, homepage_url, scrape_selector
     FROM sources WHERE COALESCE(allowed, true) = true ORDER BY id ASC`,
    []
  );
  const rows = (Array.isArray(res) ? res : (res as any).rows) as SourceRow[];
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// ingest_logs writer (this is what the admin page reads)
// ─────────────────────────────────────────────────────────────────────────────
function hostnameOf(url: string | null | undefined) {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

async function logIngest(
  src: SourceRow,
  reason: string,
  url?: string | null,
  opts?: { title?: string | null; detail?: string | null }
) {
  try {
    await dbQuery(
      `
      INSERT INTO ingest_logs
        (created_at, source_id, source, reason, url, domain, title, detail)
      VALUES
        (NOW(), $1::int, $2::text, $3::text,
         NULLIF($4::text,''), NULLIF($5::text,''), NULLIF($6::text,''), NULLIF($7::text,''))
      `,
      [
        src.id,
        src.name ?? null,
        reason,
        url ?? null,
        hostnameOf(url ?? null),
        opts?.title ?? null,
        opts?.detail ?? null,
      ]
    );
  } catch {
    // never fail ingest because of log write
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingest core
// ─────────────────────────────────────────────────────────────────────────────
type IngestSummary = { total: number; inserted: number; updated: number; skipped: number };

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
  if (jobId) {
    try {
      await setProgress(jobId, 0, limit);
    } catch {}
  }

  // 1) Candidate items via your sources/index.ts
  await log.info("Fetching candidate items", { sourceId, limit });
  let items: Array<{ title: string; link: string; publishedAt?: Date | string | null }> = [];
  try {
    items = await fetchItemsForSource(sourceId, limit);
    await log.debug("Fetched feed items", { mode: "sources-index", count: items.length });
  } catch (err: any) {
    await log.error("Failed to fetch candidates", { sourceId, error: String(err?.message ?? err) });
    items = [];
  }

  let inserted = 0,
    updated = 0,
    skipped = 0,
    processed = 0;

  for (const it of items) {
    processed++;
    if (jobId) {
      try {
        await setProgress(jobId, processed);
      } catch {}
    }

    const link = String(it?.link ?? "");
    const feedTitle = (it?.title ?? "").trim() || null;
    if (!link) {
      skipped++;
      await logIngest(src, "invalid_item", null, { detail: "empty link" });
      continue;
    }

    // Optional routing (article vs index)
    try {
      if (adapters.routeByUrl) {
        const routed = await adapters.routeByUrl(link);
        if (routed?.kind === "skip") {
          skipped++;
          await log.debug("Router suggested skip", { link, suggested_reason: routed?.reason });
          await logIngest(src, `skip_router`, link, { title: feedTitle, detail: routed?.reason ?? null });
          continue;
        }
        if (routed?.kind === "index") {
          skipped++;
          await log.debug("Skipped index/section page", { link, reason: routed?.reason, section: routed?.section });
          await logIngest(src, `skip_index`, link, { title: feedTitle, detail: routed?.reason ?? null });
          continue;
        }
      } else if (isLikelyIndexOrNonArticle(link)) {
        skipped++;
        await log.debug("Skipped non-article/index page", { link });
        await logIngest(src, "skip_index", link, { title: feedTitle });
        continue;
      }
    } catch {
      /* best-effort router */
    }

    // Normalize published_at
    let publishedAt: Date | null = null;
    const p = it?.publishedAt;
    if (p) {
      const d = new Date(p as any);
      if (!Number.isNaN(d.valueOf())) publishedAt = d;
    }

    // 2) Optional scrape enrich (canonical/title/summary/image/published_at)
    let canonical = link;
    let chosenTitle = feedTitle;
    let scrapedSummary: string | null = null;

    try {
      if (adapters.scrapeArticle) {
        const scraped = await adapters.scrapeArticle(link);
        if (scraped?.canonical_url) canonical = scraped.canonical_url!;
        if (!publishedAt && scraped?.published_at) {
          const d = new Date(scraped.published_at as any);
          if (!Number.isNaN(d.valueOf())) publishedAt = d;
        }
        if (scraped?.title) chosenTitle = scraped.title;
        scrapedSummary = (scraped as any)?.summary ?? null;

        // Run classification with scraped info (best signal)
        const klass = classifyArticle({
          title: chosenTitle ?? undefined,
          summary: scrapedSummary ?? undefined,
          url: canonical,
          sourceName: src.name ?? undefined,
        });

        const res = await upsertArticle({
          canonical_url: canonical,
          url: scraped.url ?? link,
          source_id: sourceId,
          title: chosenTitle,
          author: (scraped.author as any) ?? null,
          published_at: publishedAt,
          image_url: (scraped.image_url as any) ?? null,
          domain: hostnameOf(scraped.url ?? link) ?? null,
          sport: "nfl",
          topics: klass.topics,
          primary_topic: klass.primary,
          secondary_topic: klass.secondary,
          week: klass.week,
        });

        if (res.inserted) {
          inserted++;
          await logIngest(src, "ok_insert", canonical, { title: chosenTitle });
        } else {
          updated++;
          await logIngest(src, "ok_update", canonical, { title: chosenTitle });
        }
        continue;
      }
    } catch (err: any) {
      await log.warn("Scrape failed; falling back to basic upsert", { link, error: String(err?.message ?? err) });
      await logIngest(src, "parse_error", link, { title: feedTitle, detail: String(err?.message ?? err) });
    }

    // 3) Fallback upsert with feed data + classification from feed title/URL
    const klass = classifyArticle({
      title: feedTitle ?? undefined,
      url: link,
      sourceName: src.name ?? undefined,
    });

    const res = await upsertArticle({
      canonical_url: canonical,
      url: link,
      source_id: sourceId,
      title: feedTitle,
      author: null,
      published_at: publishedAt,
      image_url: null,
      domain: hostnameOf(link),
      sport: "nfl",
      topics: klass.topics,
      primary_topic: klass.primary,
      secondary_topic: klass.secondary,
      week: klass.week,
    });

    if (res.inserted) {
      inserted++;
      await logIngest(src, "ok_insert", canonical, { title: feedTitle });
    } else {
      updated++;
      await logIngest(src, "ok_update", canonical, { title: feedTitle });
    }
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

  if (jobId) {
    try {
      await setProgress(jobId, 0, sources.length);
    } catch {}
  }
  let done = 0;
  for (const s of sources) {
    await log.info("Ingesting source", { name: s.name ?? `#${s.id}`, sourceId: s.id });
    try {
      await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
    } catch (err: any) {
      await log.error("Source ingest failed", { sourceId: s.id, error: String(err?.message ?? err) });
      // record a fetch/parse error against this source so admin page shows it
      await logIngest(s, "fetch_error", null, { detail: String(err?.message ?? err) });
    }
    done++;
    if (jobId) {
      try {
        await setProgress(jobId, done);
      } catch {}
    }
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
    `SELECT id, name, allowed, rss_url, homepage_url, scrape_selector
     FROM sources ORDER BY id ASC`,
    []
  );
  const rows = (Array.isArray(res) ? res : (res as any).rows) as SourceRow[];

  await log.info("Starting ingest for all sources", { count: rows.length, perSourceLimit });

  if (jobId) {
    try {
      await setProgress(jobId, 0, rows.length);
    } catch {}
  }
  let done = 0;
  for (const s of rows) {
    await log.info("Ingesting source", { name: s.name ?? `#${s.id}`, sourceId: s.id });
    try {
      await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
    } catch (err: any) {
      await log.error("Source ingest failed", { sourceId: s.id, error: String(err?.message ?? err) });
      await logIngest(s, "fetch_error", null, { detail: String(err?.message ?? err) });
    }
    done++;
    if (jobId) {
      try {
        await setProgress(jobId, done);
      } catch {}
    }
  }

  await log.info("All sources finished", { count: rows.length });
}

// ─────────────────────────────────────────────────────────────────────────────
// Job wrappers
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
