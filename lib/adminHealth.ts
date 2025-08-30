// lib/adminHealth.ts
import { dbQuery } from "@/lib/db";

/** One source's health over a recent time window */
export type SourceHealth = {
  id: number;
  name: string | null;
  allowed: boolean | null;
  rss_url: string | null;
  homepage_url: string | null;
  scrape_selector: string | null;
  lastDiscovered: string | null;
  firstDiscovered: string | null;
  articlesInWindow: number;
  totalArticles: number;
  status: "ok" | "stale" | "cold";
  suggestion: string | null;
};

/** Recent ingest error rollups per source (window-scoped) */
export type ErrorDigest = {
  source_id: number;
  source: string;
  total: number;
  lastAt: string;
  lastDetail: string | null;
  lastStatus: number | null;
  sampleUrl: string | null;
  rss_url: string | null;
  homepage_url: string | null;
  allowed: boolean | null;
};

/** Page summary + per-source rows */
export type HealthSummary = {
  generatedAt: string;
  windowHours: number;
  sourcesTotal: number;
  sourcesPulled: number;
  sourcesBlank: number;
  mostRecent: string | null;
  oldest: string | null;
  insertedTotal?: number;
  updatedTotal?: number;
  skippedTotal?: number;
  perSource: SourceHealth[];
  errors?: ErrorDigest[];
};

export type IngestTalliesBySource = Record<
  number,
  { inserted: number; updated: number; skipped: number }
>;

function getPgCode(err: unknown): string | undefined {
  return typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : undefined;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function clampHours(h: number): number {
  // 1 hour min, 30 days max
  return Math.max(1, Math.min(h, 24 * 30));
}

/** Compute per-source + total ingest tallies from ingest_logs. */
export async function getIngestTallies(
  windowHours = 72
): Promise<{ bySource: IngestTalliesBySource; totals: { inserted: number; updated: number; skipped: number } }> {
  const wh = clampHours(windowHours);

  try {
    const rows = (
      await dbQuery<{
        source_id: number;
        inserted: string; // numeric comes back as string in pg
        updated: string;
        skipped: string;
      }>(
        `
        WITH win AS (
          SELECT *
          FROM ingest_logs
          WHERE created_at >= NOW() - ($1::int || ' hours')::interval
        )
        SELECT
          COALESCE(source_id, 0) AS source_id,
          SUM(CASE WHEN reason = 'ok_insert' THEN 1 ELSE 0 END)::bigint AS inserted,
          SUM(CASE WHEN reason = 'ok_update' THEN 1 ELSE 0 END)::bigint AS updated,
          SUM(CASE
                WHEN reason = 'invalid_item'
                  OR reason LIKE 'skip_%'
                THEN 1 ELSE 0 END
          )::bigint AS skipped
        FROM win
        GROUP BY source_id
        `,
        [wh]
      )
    ).rows;

    const bySource: IngestTalliesBySource = {};
    let ins = 0;
    let upd = 0;
    let skp = 0;

    for (const r of rows) {
      const sid = Number(r.source_id);
      const inserted = Number(r.inserted ?? 0);
      const updated = Number(r.updated ?? 0);
      const skipped = Number(r.skipped ?? 0);
      if (sid > 0) bySource[sid] = { inserted, updated, skipped };
      ins += inserted;
      upd += updated;
      skp += skipped;
    }

    return { bySource, totals: { inserted: ins, updated: upd, skipped: skp } };
  } catch (e: unknown) {
    // Missing table? Fall back to zeros.
    if (getPgCode(e) === "42P01") {
      return { bySource: {}, totals: { inserted: 0, updated: 0, skipped: 0 } };
    }
    throw e;
  }
}

/**
 * Compute health for all sources over a time window (default 72h).
 * If `ingestTallies` is omitted, this will compute totals from `ingest_logs`.
 */
export async function getSourcesHealth(
  windowHours = 72,
  ingestTallies?: IngestTalliesBySource
): Promise<HealthSummary> {
  const wh = clampHours(windowHours);

  // Pull per-source recency + counts
  const rows = (
    await dbQuery<{
      id: number;
      name: string | null;
      allowed: boolean | null;
      rss_url: string | null;
      homepage_url: string | null;
      scrape_selector: string | null;
      last_discovered: string | null;
      first_discovered: string | null;
      in_window: string | null;
      total_articles: string | null;
    }>(
      `
      WITH win AS (
        SELECT
          s.id, s.name, s.allowed, s.rss_url, s.homepage_url, s.scrape_selector,
          MAX(a.discovered_at) AS last_discovered,
          MIN(a.discovered_at) AS first_discovered,
          COUNT(*) FILTER (
            WHERE a.discovered_at >= NOW() - ($1::int || ' hours')::interval
          ) AS in_window,
          COUNT(*) AS total_articles
        FROM sources s
        LEFT JOIN articles a ON a.source_id = s.id
        GROUP BY s.id, s.name, s.allowed, s.rss_url, s.homepage_url, s.scrape_selector
      )
      SELECT * FROM win
      ORDER BY id ASC
      `,
      [wh]
    )
  ).rows;

  // Site-wide most recent / oldest
  const siteAgg =
    (
      await dbQuery<{ most_recent: string | null; oldest: string | null }>(
        `SELECT MAX(discovered_at) AS most_recent, MIN(discovered_at) AS oldest FROM articles`
      )
    ).rows[0] ?? { most_recent: null, oldest: null };

  const perSource: SourceHealth[] = rows.map((r) => {
    const inWindow = Number(r.in_window ?? 0);
    const total = Number(r.total_articles ?? 0);

    let status: SourceHealth["status"] = "ok";
    if (total === 0) status = "cold";
    else if (inWindow === 0 && (r.allowed ?? true)) status = "stale";

    // Suggestions
    const hasRss = !!r.rss_url;
    const hasScrape = !!r.homepage_url && !!r.scrape_selector;
    let suggestion: string | null = null;
    if (status !== "ok") {
      if (r.homepage_url && !r.scrape_selector) suggestion = "Add a scrape_selector for homepage_url.";
      else if (hasRss && !hasScrape) suggestion = "RSS may be broken/blocked — consider scraping.";
      else if (!hasRss && !hasScrape) suggestion = "No ingest configured (RSS/scrape).";
      else suggestion = "Check feed/selector — likely changed.";
    }

    // If caller provided per-source tallies, and this source had zero activity in the run, note it.
    const t = ingestTallies?.[r.id];
    if (t && t.inserted + t.updated + t.skipped === 0 && (r.allowed ?? true)) {
      suggestion = suggestion ?? "No rows in the last ingest run.";
    }

    return {
      id: r.id,
      name: r.name,
      allowed: r.allowed,
      rss_url: r.rss_url,
      homepage_url: r.homepage_url,
      scrape_selector: r.scrape_selector,
      lastDiscovered: r.last_discovered,
      firstDiscovered: r.first_discovered,
      articlesInWindow: inWindow,
      totalArticles: total,
      status,
      suggestion,
    };
  });

  const sourcesPulled = perSource.filter((s) => s.articlesInWindow > 0).length;
  const sourcesBlank = perSource.filter((s) => (s.allowed ?? true) && s.articlesInWindow === 0).length;

  const summary: HealthSummary = {
    generatedAt: new Date().toISOString(),
    windowHours: wh,
    sourcesTotal: perSource.length,
    sourcesPulled,
    sourcesBlank,
    mostRecent: siteAgg.most_recent,
    oldest: siteAgg.oldest,
    perSource,
  };

  // Fill totals: use caller-provided tallies if given, else compute from ingest_logs.
  if (ingestTallies) {
    let ins = 0,
      upd = 0,
      skp = 0;
    for (const t of Object.values(ingestTallies)) {
      ins += t.inserted;
      upd += t.updated;
      skp += t.skipped;
    }
    summary.insertedTotal = ins;
    summary.updatedTotal = upd;
    summary.skippedTotal = skp;
  } else {
    try {
      const { totals } = await getIngestTallies(wh);
      summary.insertedTotal = totals.inserted;
      summary.updatedTotal = totals.updated;
      summary.skippedTotal = totals.skipped;
    } catch (e: unknown) {
      const code = getPgCode(e);
      if (code !== "42P01") {
        console.warn("[adminHealth] getIngestTallies failed:", getErrorMessage(e));
      }
      summary.insertedTotal = 0;
      summary.updatedTotal = 0;
      summary.skippedTotal = 0;
    }
  }

  // Attach recent ingest error digests (safe if table missing)
  try {
    summary.errors = await getSourceErrorDigests(wh);
  } catch (e: unknown) {
    const code = getPgCode(e);
    if (code !== "42P01") {
      console.warn("[adminHealth] getSourceErrorDigests failed:", getErrorMessage(e));
    }
    summary.errors = [];
  }

  return summary;
}

/** Roll up recent ingest errors (fetch/parse) within the window. */
export async function getSourceErrorDigests(windowHours = 72): Promise<ErrorDigest[]> {
  const wh = clampHours(windowHours);

  const rows = (
    await dbQuery<{
      source_id: number;
      source: string | null;
      rss_url: string | null;
      homepage_url: string | null;
      allowed: boolean | null;
      total: string;
      last_at: string | null;
      last_detail: string | null;
      sample_url: string | null;
    }>(
      `
      WITH errs AS (
        SELECT
          l.source_id,
          COUNT(*) AS total,
          MAX(l.created_at) AS last_at,
          (ARRAY_AGG(l.detail ORDER BY l.created_at DESC))[1] AS last_detail,
          (ARRAY_AGG(l.url    ORDER BY l.created_at DESC))[1] AS sample_url
        FROM ingest_logs l
        WHERE l.created_at >= NOW() - ($1::int || ' hours')::interval
          AND l.reason IN ('fetch_error','parse_error','scrape_no_matches','invalid_item')
        GROUP BY l.source_id
      )
      SELECT
        e.source_id,
        s.name     AS source,
        s.rss_url,
        s.homepage_url,
        s.allowed,
        e.total,
        e.last_at,
        e.last_detail,
        e.sample_url
      FROM errs e
      JOIN sources s ON s.id = e.source_id
      ORDER BY e.last_at DESC
      `,
      [wh]
    )
  ).rows;

  return rows.map((r) => {
    const m =
      /Status code\s+(\d{3})/.exec(r.last_detail ?? "") ||
      /(\b\d{3}\b)/.exec(r.last_detail ?? "");
    const lastStatus = m ? Number(m[1]) : null;

    return {
      source_id: r.source_id,
      source: r.source ?? `#${r.source_id}`,
      total: Number(r.total ?? 0),
      lastAt: r.last_at ?? new Date().toISOString(),
      lastDetail: r.last_detail ?? null,
      lastStatus,
      sampleUrl: r.sample_url ?? null,
      rss_url: r.rss_url ?? null,
      homepage_url: r.homepage_url ?? null,
      allowed: r.allowed,
    };
  });
}
