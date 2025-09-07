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
import { upsertPlayerImage } from "@/lib/ingestPlayerImages"; // keeps player_images logic separate
import { findArticleImage } from "@/lib/scrape-image";       // OG/Twitter/JSON-LD finder
import { isWeakArticleImage, extractPlayersFromTitleAndUrl } from "@/lib/images";

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
      author?: string | null;
      image_url?: string | null;
      url?: string | null;
      published_at?: Date | string | null;
    }
  >;
  routeByUrl?: (
    url: string
  ) => Promise<{ kind: "article" | "index" | "skip"; reason?: string; section?: string }>;
};

function isPromise<T>(v: unknown): v is Promise<T> {
  return !!v && typeof (v as { then?: unknown }).then === "function";
}

type IngestDecision = { kind: "article" | "index" | "skip"; reason?: string; section?: string };

function normalizeDecision(v: unknown): IngestDecision {
  const k = (v as { kind?: unknown }).kind;
  const reason = (v as { reason?: unknown }).reason;
  const section = (v as { section?: unknown }).section;
  const kind: IngestDecision["kind"] =
    k === "article" || k === "index" || k === "skip" ? k : "article";
  return {
    kind,
    ...(typeof reason === "string" ? { reason } : {}),
    ...(typeof section === "string" ? { section } : {}),
  };
}

function toPlayerKey(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `nfl:name:${slug}`;
}

function looksUsableImage(u: string | null | undefined): u is string {
  if (!u) return false;
  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/\.svg(\?|#|$)/i.test(s)) return false;
  return !isWeakArticleImage(s);
}

async function loadAdapters(): Promise<Adapters> {
  // Lazy, best-effort dynamic imports without introducing 'any' at callsites.
  let extractCanonicalUrl: Adapters["extractCanonicalUrl"];
  let scrapeArticle: Adapters["scrapeArticle"];
  let routeByUrl: Adapters["routeByUrl"];

  try {
    const modUnknown: unknown = await import("./sources/adapters");
    const mod = modUnknown as Record<string, unknown>;

    const maybeScrape = mod["scrapeArticle"];
    if (typeof maybeScrape === "function") {
      scrapeArticle = maybeScrape as Adapters["scrapeArticle"];
    }

    const maybeExtract = mod["extractCanonicalUrl"];
    if (typeof maybeExtract === "function") {
      extractCanonicalUrl = maybeExtract as Adapters["extractCanonicalUrl"];
    }

    const maybeRoute = mod["routeByUrl"];
    if (typeof maybeRoute === "function") {
      const raw = maybeRoute as (...args: unknown[]) => unknown;
      routeByUrl = async (url: string) => {
        const out = raw(url);
        const val = isPromise<unknown>(out) ? await out : out;
        return normalizeDecision(val);
      };
    }
  } catch {
    /* optional module; ignore */
  }

  return { extractCanonicalUrl, scrapeArticle, routeByUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job-aware logger
// ─────────────────────────────────────────────────────────────────────────────
function mkLogger(jobId?: string) {
  const send = async (level: JobEventLevel, message: string, meta?: Record<string, unknown>) => {
    if (!jobId) return;
    try {
      await appendEvent(jobId, level, message, meta);
    } catch {
      /* noop */
    }
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
  topics?: string[] | null;
  primary_topic?: string | null;
  secondary_topic?: string | null;
  week?: number | null;
  players?: string[] | null;
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

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const obj = res as { rows?: T[] };
  return Array.isArray(obj?.rows) ? (obj.rows as T[]) : [];
}

export async function upsertArticle(row: ArticleInput): Promise<UpsertResult> {
  const primary = pickNonEmpty(row.canonical_url, row.url, row.link);
  if (!primary) return { inserted: false };

  const canonical = pickNonEmpty(row.canonical_url, primary)!;
  const url = pickNonEmpty(row.url, primary)!;

  let publishedAt: Date | null = null;
  if (row.published_at) {
    const d = new Date(row.published_at as string);
    publishedAt = Number.isNaN(d.valueOf()) ? null : d;
  }

  const topicsArr = Array.isArray(row.topics) ? row.topics : null;
  const playersArr = Array.isArray(row.players) ? row.players : null;

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
    playersArr, // $14 ::text[]
  ];

  const sql = `
    INSERT INTO articles (
      canonical_url, url, source_id, title, author, published_at,
      image_url, domain, sport, discovered_at,
      topics, primary_topic, secondary_topic, week, players
    ) VALUES (
      $1::text, $2::text, $3::int,
      NULLIF($4::text,''), NULLIF($5::text,''),
      $6::timestamptz,
      NULLIF($7::text,''), NULLIF($8::text,''), NULLIF($9::text,''),
      NOW(),
      $10::text[], NULLIF($11::text,''), NULLIF($12::text,''), $13::int, $14::text[]
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
      week           = COALESCE(EXCLUDED.week, articles.week),
      players        = COALESCE(EXCLUDED.players, articles.players)
    RETURNING (xmax = 0) AS inserted;
  `;

  const res = await dbQuery<{ inserted: boolean }>(sql, params);
  const rows = rowsOf<{ inserted: boolean }>(res);
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
  const rows = rowsOf<SourceRow>(res);
  return rows?.[0] ?? null;
}

export async function getAllowedSources(): Promise<SourceRow[]> {
  const res = await dbQuery<SourceRow>(
    `SELECT id, name, allowed, rss_url, homepage_url, scrape_selector
     FROM sources WHERE COALESCE(allowed, true) = true ORDER BY id ASC`,
    []
  );
  return rowsOf<SourceRow>(res);
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
// Helpers: image backfill + players extraction
// ─────────────────────────────────────────────────────────────────────────────

/** After an upsert, if image is missing/weak, try to fetch a better one and persist. */
async function backfillArticleImage(
  articleId: number,
  canonicalUrl: string,
  currentImageUrl: string | null,
  topic: string | null
): Promise<string | null> {
  const hasUsable = currentImageUrl && !isWeakArticleImage(currentImageUrl);
  if (hasUsable) return currentImageUrl;

  const best = await findArticleImage(canonicalUrl);
  if (!best) {
    await dbQuery(
      `UPDATE articles
         SET image_checked_at = NOW()
       WHERE id = $1`,
      [articleId]
    );
    return null;
  }

  await dbQuery(
    `UPDATE articles
        SET image_url = $2,
            image_source = 'scraped',
            image_checked_at = NOW()
      WHERE id = $1`,
    [articleId, best]
  );
  return best;
}



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
    } catch {
      /* noop */
    }
  }

  // 1) Candidate items via your sources/index.ts
  await log.info("Fetching candidate items", { sourceId, limit });
  let items: Array<{ title: string; link: string; publishedAt?: Date | string | null }> = [];
  try {
    items = await fetchItemsForSource(sourceId, limit);
    await log.debug("Fetched feed items", { mode: "sources-index", count: items.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await log.error("Failed to fetch candidates", { sourceId, error: msg });
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
      } catch {
        /* noop */
      }
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
          await logIngest(
            src,
            `skip_router`,
            link,
            { title: feedTitle, detail: routed?.reason ?? null }
          );
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
      const d = new Date(p as string);
      if (!Number.isNaN(d.valueOf())) publishedAt = d;
    }

    // 2) Optional scrape enrich (canonical/title/summary/image/published_at)
    let canonical = link;
    let chosenTitle = feedTitle;
    let scrapedImage: string | null = null;
    let chosenPlayers = extractPlayersFromTitleAndUrl(chosenTitle, canonical);

    try {
      if (adapters.scrapeArticle) {
        const scraped = await adapters.scrapeArticle(link);
        if (scraped?.canonical_url) canonical = scraped.canonical_url!;
        if (!publishedAt && scraped?.published_at) {
          const d = new Date(scraped.published_at as string);
          if (!Number.isNaN(d.valueOf())) publishedAt = d;
        }
        if (scraped?.title) {
          chosenTitle = scraped.title;
          chosenPlayers = extractPlayersFromTitleAndUrl(chosenTitle, canonical);

        }
        scrapedImage = scraped?.image_url ?? null;

        // Run classification with scraped info (best signal)
        const klass = classifyArticle({
          title: chosenTitle ?? undefined,
          summary: (scraped as { summary?: string | null })?.summary ?? undefined,
          url: canonical,
          sourceName: src.name ?? undefined,
        });

        const res = await upsertArticle({
          canonical_url: canonical,
          url: scraped.url ?? link,
          source_id: sourceId,
          title: chosenTitle,
          author: scraped.author ?? null,
          published_at: publishedAt,
          image_url: scrapedImage,
          domain: hostnameOf(scraped.url ?? link) ?? null,
          sport: "nfl",
          topics: klass.topics,
          primary_topic: klass.primary,
          secondary_topic: klass.secondary,
          week: klass.week,
          players: chosenPlayers,
        });

        const action = res.inserted ? "ok_insert" : "ok_update";
        if (res.inserted) inserted++; else updated++;
        await logIngest(src, action, canonical, { title: chosenTitle });

        // 2b) First-pass thumbnail store (if blank/weak) + seed (if single player)
        await backfillAfterUpsert(
          canonical,
          klass.primary,
          (chosenPlayers && chosenPlayers.length === 1) ? chosenPlayers[0] : null
        );

        // 2c) Opportunistic headshot seed from scraped image (low priority)
        if (chosenPlayers && chosenPlayers.length === 1 && looksUsableImage(scrapedImage)) {
          const key = `nfl:name:${chosenPlayers[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          await upsertPlayerImage({ key: key, url: scrapedImage! });
        }

        continue;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log.warn("Scrape failed; falling back to basic upsert", { link, error: msg });
      await logIngest(src, "parse_error", link, { title: feedTitle, detail: msg });
    }

    // 3) Fallback upsert with feed data + classification from feed title/URL
    const klass = classifyArticle({
      title: feedTitle ?? undefined,
      url: link,
      sourceName: src.name ?? undefined,
    });

    const players = extractPlayersFromTitleAndUrl(chosenTitle, canonical);


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
      players,
    });

    const action = res.inserted ? "ok_insert" : "ok_update";
    if (res.inserted) inserted++; else updated++;
    await logIngest(src, action, canonical, { title: feedTitle });

    // 3b) First-pass thumbnail store (if blank/weak) + optional seed
    await backfillAfterUpsert(
      canonical,
      klass.primary,
      (players && players.length === 1) ? players[0] : null
    );
  }

  const summary = { total: items.length, inserted, updated, skipped };
  await log.info("Ingest summary", summary);
  return summary;

  // ── local helper to avoid a second query for id/fields ─────────────────────
  async function backfillAfterUpsert(
    canon: string,
    primaryTopic: string | null,
    possiblePlayerName?: string | null
  ) {
    // get id + current image to decide whether to fetch a thumbnail
    const rs = await dbQuery<{ id: number; image_url: string | null }>(
      `SELECT id, image_url FROM articles WHERE canonical_url = $1`,
      [canon]
    );
    const row = rowsOf<{ id: number; image_url: string | null }>(rs)[0];
    if (!row) return;

    const best = await backfillArticleImage(row.id, canon, row.image_url, primaryTopic ?? null);

    // If we inferred exactly one player and we found a usable image, seed player_images
    if (possiblePlayerName && looksUsableImage(best)) {
      const key = toPlayerKey(possiblePlayerName);
      await upsertPlayerImage({ key, url: best });
    }
  }
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
    } catch {
      /* noop */
    }
  }
  let done = 0;
  for (const s of sources) {
    await log.info("Ingesting source", { name: s.name ?? `#${s.id}`, sourceId: s.id });
    try {
      await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log.error("Source ingest failed", { sourceId: s.id, error: msg });
      await logIngest(s, "fetch_error", null, { detail: msg });
    }
    done++;
    if (jobId) {
      try {
        await setProgress(jobId, done);
      } catch {
        /* noop */
      }
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
  const rows = rowsOf<SourceRow>(res);

  await log.info("Starting ingest for all sources", { count: rows.length, perSourceLimit });

  if (jobId) {
    try {
      await setProgress(jobId, 0, rows.length);
    } catch {
      /* noop */
    }
  }
  let done = 0;
  for (const s of rows) {
    await log.info("Ingesting source", { name: s.name ?? `#${s.id}`, sourceId: s.id });
    try {
      await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log.error("Source ingest failed", { sourceId: s.id, error: msg });
      await logIngest(s, "fetch_error", null, { detail: msg });
    }
    done++;
    if (jobId) {
      try {
        await setProgress(jobId, done);
      } catch {
        /* noop */
      }
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(job.id, msg);
    throw new Error(msg);
  }
}

export async function runAllAllowedSourcesIngestWithJob(perSourceLimit = 50) {
  const { createJob } = await import("@/lib/jobs");
  const job = await createJob("ingest", { scope: "allowed", perSourceLimit });
  try {
    await ingestAllAllowedSources({ jobId: job.id, perSourceLimit });
    await finishJobSuccess(job.id, "success");
    return { jobId: job.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(job.id, msg);
    throw new Error(msg);
  }
}
