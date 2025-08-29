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

  /** ISO strings; null when no articles exist */
  lastDiscovered: string | null;
  firstDiscovered: string | null;

  /** Counts */
  articlesInWindow: number;
  totalArticles: number;

  /** Status & suggestion */
  status: "ok" | "stale" | "cold";
  suggestion: string | null;
};

/** Recent ingest error rollups per source (window-scoped) */
export type ErrorDigest = {
  source_id: number;
  source: string;
  total: number;              // total errors in window
  lastAt: string;             // ISO
  lastDetail: string | null;  // e.g. "Status code 404"
  lastStatus: number | null;  // parsed status code, if found (e.g. 404)
  sampleUrl: string | null;   // the URL that last errored
  rss_url: string | null;
  homepage_url: string | null;
  allowed: boolean | null;
};

/** Page summary + per-source rows */
export type HealthSummary = {
  generatedAt: string;       // ISO
  windowHours: number;

  sourcesTotal: number;
  sourcesPulled: number;     // ≥1 article in window
  sourcesBlank: number;      // allowed + 0 in window
  mostRecent: string | null; // sitewide
  oldest: string | null;     // sitewide

  /** Optional ingest tallies (if provided by caller) */
  insertedTotal?: number;
  updatedTotal?: number;
  skippedTotal?: number;

  perSource: SourceHealth[];
  /** NEW: recent ingest error digests (fetch/parse failures etc.) */
  errors?: ErrorDigest[];
};


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


/**
 * Compute health for all sources over a time window (default 72h).
 * If you have ingest tallies, you can sum them into the top row by
 * passing a map { [sourceId]: { inserted, updated, skipped } }.
 */
export async function getSourcesHealth(
  windowHours = 72,
  ingestTallies?: Record<number, { inserted: number; updated: number; skipped: number }>
): Promise<HealthSummary> {
  const wh = Math.max(1, Math.min(windowHours, 24 * 30)); // cap 30d

  // Per-source recency + counts
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
      in_window: number;
      total_articles: number;
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
        `
        SELECT MAX(discovered_at) AS most_recent,
               MIN(discovered_at) AS oldest
        FROM articles
        `
      )
    ).rows[0] ?? { most_recent: null, oldest: null };

  const perSource: SourceHealth[] = rows.map((r) => {
    let status: SourceHealth["status"] = "ok";
    if ((r.total_articles ?? 0) === 0) status = "cold";
    else if ((r.in_window ?? 0) === 0 && (r.allowed ?? true)) status = "stale";

    // Simple suggestions
    let suggestion: string | null = null;
    const hasRss = !!r.rss_url;
    const hasScrape = !!r.homepage_url && !!r.scrape_selector;

    if (status !== "ok") {
      if (r.homepage_url && !r.scrape_selector) {
        suggestion = "Add a scrape_selector for homepage_url.";
      } else if (hasRss && !hasScrape) {
        suggestion = "RSS may be broken/blocked — consider scraping.";
      } else if (!hasRss && !hasScrape) {
        suggestion = "No ingest configured (RSS/scrape).";
      } else {
        suggestion = "Check feed/selector — likely changed.";
      }
    }

    // If caller passed ingest tallies, annotate a zero-activity run
    if (ingestTallies?.[r.id]) {
      const t = ingestTallies[r.id];
      if (t.inserted + t.updated + t.skipped === 0 && (r.allowed ?? true)) {
        suggestion = suggestion ?? "No rows in the last ingest run.";
      }
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
      articlesInWindow: Number(r.in_window ?? 0),
      totalArticles: Number(r.total_articles ?? 0),
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

  // Merge tallies into top row if provided
  if (ingestTallies) {
    let ins = 0, upd = 0, skp = 0;
    for (const t of Object.values(ingestTallies)) {
      ins += t.inserted;
      upd += t.updated;
      skp += t.skipped;
    }
    summary.insertedTotal = ins;
    summary.updatedTotal = upd;
    summary.skippedTotal = skp;
  }

  // NEW: attach recent ingest error digests
  summary.errors = await getSourceErrorDigests(wh);
    // Merge tallies into top row if provided
  if (ingestTallies) {
    let ins = 0, upd = 0, skp = 0;
    for (const t of Object.values(ingestTallies)) {
      ins += t.inserted;
      upd += t.updated;
      skp += t.skipped;
    }
    summary.insertedTotal = ins;
    summary.updatedTotal = upd;
    summary.skippedTotal = skp;
  }

  // 🆕 Attach recent ingest error digests (safe even if table is missing)
  try {
    summary.errors = await getSourceErrorDigests(wh);
  } catch (e: unknown) {
  // 42P01 = relation does not exist (ingest_logs not created yet)
  const code = getPgCode(e);
  if (code !== "42P01") {
    console.warn("[adminHealth] getSourceErrorDigests failed:", getErrorMessage(e));
  }
  summary.errors = [];
}
  return summary;
}

/** Roll up recent ingest errors (fetch/parse) within the window. */
export async function getSourceErrorDigests(
  windowHours = 72
): Promise<ErrorDigest[]> {
  const wh = Math.max(1, Math.min(windowHours, 24 * 30));

  // Adjust table/columns if yours differ.
  const rows = (
    await dbQuery<{
      source_id: number;
      source: string | null;
      rss_url: string | null;
      homepage_url: string | null;
      allowed: boolean | null;
      total: number;
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
          AND l.reason IN ('fetch_error', 'invalid_item')
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

  // Parse an HTTP status code out of detail text when present
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
