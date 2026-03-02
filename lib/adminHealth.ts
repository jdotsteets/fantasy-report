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

export type PerSourceIngestRow = {
  source_id: number;
  source: string | null;
  inserted: number;
  updated: number;
  skipped: number;
  lastAt: string | null; // last successful ingest for this source
  allowed: boolean | null;
  homepage_url: string | null;
  rss_url: string | null;
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

  perSource: SourceHealth[];            // ← was Array<any>
  errors?: ErrorDigest[];               // ← was Array<any>
  perSourceIngest?: PerSourceIngestRow[];
};

// ── Types ───────────────────────────────────────────────
export type SourceIngestSummary = {
  source_id: number;
  source: string;
  allowed: boolean | null;
  rss_url: string | null;
  homepage_url: string | null;
  inserted: number;
  updated: number;
  skipped: number;
  lastAt: string | null; // last log timestamp for this source in window
};

export type IngestTalliesBySource = Record<
  number,
  { inserted: number; updated: number; skipped: number; lastAt: string | null }
>;

/* Normalize dbQuery results (T[] or { rows: T[] }) */
type ResultLike<T> = T[] | { rows?: T[] };
function toRows<T>(res: unknown): T[] {
  const v = res as ResultLike<T>;
  if (Array.isArray(v)) return v;
  return Array.isArray(v.rows) ? v.rows : [];
}

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
): Promise<{
  bySource: IngestTalliesBySource;
  totals: { inserted: number; updated: number; skipped: number };
}> {
  const wh = clampHours(windowHours);

  try {
    type Row = {
      source_id: number;   // 0 => unresolved
      inserted: string;    // bigint as text
      updated: string;
      skipped: string;
      last_at: string | null;
    };

    const res = await dbQuery<Row>(
      `
      WITH win AS (
        SELECT l.*
        FROM ingest_logs l
        WHERE l.created_at >= NOW() - ($1::int || ' hours')::interval
      ),
      -- normalize URL/domain -> host (lower, strip leading 'www.')
      hosty AS (
        SELECT
          w.*,
          NULLIF(
            lower(regexp_replace(regexp_replace(w.url    , '^(?:[a-z]+://)?([^/:?#]+).*$', '\\1'), '^www\\.', '')),
            ''
          ) AS url_host,
          NULLIF(
            lower(regexp_replace(regexp_replace(w.domain , '^(?:[a-z]+://)?([^/:?#]+).*$', '\\1'), '^www\\.', '')),
            ''
          ) AS dom_host
        FROM win w
      ),
      src_hosts AS (
        SELECT
          s.id,
          lower(s.name) AS name_lc,
          NULLIF(lower(regexp_replace(regexp_replace(s.homepage_url, '^(?:[a-z]+://)?([^/:?#]+).*$', '\\1'), '^www\\.', '')), '') AS home_host,
          NULLIF(lower(regexp_replace(regexp_replace(s.rss_url     , '^(?:[a-z]+://)?([^/:?#]+).*$', '\\1'), '^www\\.', '')), '') AS rss_host
        FROM sources s
      ),
      resolved AS (
        SELECT
          COALESCE(
            h.source_id,
            s_name.id,
            s_dom.id,
            s_url.id
          ) AS sid,
          h.reason,
          h.created_at
        FROM hosty h
        -- 1) exact name (case-insensitive)
        LEFT JOIN LATERAL (
          SELECT id
          FROM src_hosts
          WHERE name_lc = lower(h.source)
          LIMIT 1
        ) AS s_name ON h.source_id IS NULL
        -- 2) domain column → match to home/rss host
        LEFT JOIN LATERAL (
          SELECT id
          FROM src_hosts
          WHERE h.dom_host IS NOT NULL
            AND (home_host = h.dom_host OR rss_host = h.dom_host)
          LIMIT 1
        ) AS s_dom ON h.source_id IS NULL AND s_name.id IS NULL
        -- 3) url column → match to home/rss host
        LEFT JOIN LATERAL (
          SELECT id
          FROM src_hosts
          WHERE h.url_host IS NOT NULL
            AND (home_host = h.url_host OR rss_host = h.url_host)
          LIMIT 1
        ) AS s_url ON h.source_id IS NULL AND s_name.id IS NULL AND s_dom.id IS NULL
      )
      SELECT
        COALESCE(sid, 0) AS source_id,
        -- accept both legacy and current reason strings
        SUM(CASE WHEN reason IN ('ok_insert','inserted') THEN 1 ELSE 0 END)::bigint AS inserted,
        SUM(CASE WHEN reason IN ('ok_update','updated') THEN 1 ELSE 0 END)::bigint AS updated,
        SUM(CASE
              WHEN reason IN ('invalid_item','skipped')
                OR reason LIKE 'skip_%'
            THEN 1 ELSE 0 END
        )::bigint AS skipped,
        MAX(created_at) AS last_at
      FROM resolved
      GROUP BY COALESCE(sid, 0)
      ORDER BY 1
      `,
      [wh]
    );
    const rows = toRows<Row>(res);

    const bySource: IngestTalliesBySource = {};
    let ins = 0, upd = 0, skp = 0;

    for (const r of rows) {
      const sid = Number(r.source_id);
      const inserted = Number(r.inserted ?? 0);
      const updated  = Number(r.updated  ?? 0);
      const skipped  = Number(r.skipped  ?? 0);
      const lastAt   = r.last_at ?? null;

      // totals include unresolved sid=0
      ins += inserted; upd += updated; skp += skipped;

      if (sid > 0) bySource[sid] = { inserted, updated, skipped, lastAt };
    }

    return { bySource, totals: { inserted: ins, updated: upd, skipped: skp } };
  } catch (e: unknown) {
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
  ingestTalliesArg?: IngestTalliesBySource
): Promise<HealthSummary> {
  const wh = clampHours(windowHours);

  // Pull per-source recency + article counts
  type SRow = {
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
  };

  const resSources = await dbQuery<SRow>(
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
  );
  const rows = toRows<SRow>(resSources);

  // Site-wide most recent / oldest
  const resAgg = await dbQuery<{ most_recent: string | null; oldest: string | null }>(
    `SELECT MAX(discovered_at) AS most_recent, MIN(discovered_at) AS oldest FROM articles`
  );
  const siteAgg = toRows<{ most_recent: string | null; oldest: string | null }>(resAgg)[0] ?? {
    most_recent: null,
    oldest: null,
  };

  // ── ingest tallies (per-source + totals) ──────────────────────────
  let bySourceTallies: IngestTalliesBySource = {};
  let totals = { inserted: 0, updated: 0, skipped: 0 };

  if (ingestTalliesArg) {
    // caller supplied (e.g., from an ingest run)
    bySourceTallies = ingestTalliesArg;
    for (const t of Object.values(ingestTalliesArg)) {
      totals.inserted += t.inserted;
      totals.updated  += t.updated;
      totals.skipped  += t.skipped;
    }
  } else {
    try {
      const t = await getIngestTallies(wh);
      bySourceTallies = t.bySource;
      totals = t.totals;
    } catch (e: unknown) {
      // Safe fallback when ingest_logs table isn't present yet
      if (getPgCode(e) !== "42P01") {
        console.warn("[adminHealth] getIngestTallies failed:", getErrorMessage(e));
      }
      bySourceTallies = {};
      totals = { inserted: 0, updated: 0, skipped: 0 };
    }
  }

  // ── derive per-source health rows (recency + simple suggestions) ──
  const perSource: SourceHealth[] = rows.map((r) => {
    const inWindow = Number(r.in_window ?? 0);
    const total = Number(r.total_articles ?? 0);

    let status: SourceHealth["status"] = "ok";
    if (total === 0) status = "cold";
    else if (inWindow === 0 && (r.allowed ?? true)) status = "stale";

    // suggestions
    const hasRss = !!r.rss_url;
    const hasScrape = !!r.homepage_url && !!r.scrape_selector;
    let suggestion: string | null = null;
    if (status !== "ok") {
      if (r.homepage_url && !r.scrape_selector) suggestion = "Add a scrape_selector for homepage_url.";
      else if (hasRss && !hasScrape) suggestion = "RSS may be broken/blocked — consider scraping.";
      else if (!hasRss && !hasScrape) suggestion = "No ingest configured (RSS/scrape).";
      else suggestion = "Check feed/selector — likely changed.";
    }

    // If this source had zero activity in the ingest tallies during the window, nudge.
    const t = bySourceTallies[r.id];
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

  // ── build the table rows used by /admin/sources (perSourceIngest) ──
  const perSourceIngest: PerSourceIngestRow[] = rows.map((s) => {
    const t = bySourceTallies[s.id] ?? {
      inserted: 0,
      updated: 0,
      skipped: 0,
      lastAt: null as string | null,
    };
    return {
      source_id: s.id,
      source: s.name ?? `#${s.id}`,
      allowed: s.allowed,
      homepage_url: s.homepage_url,
      rss_url: s.rss_url,
      inserted: t.inserted,
      updated: t.updated,
      skipped: t.skipped,
      lastAt: t.lastAt,
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
    insertedTotal: totals.inserted,
    updatedTotal: totals.updated,
    skippedTotal: totals.skipped,
    perSource,
    perSourceIngest,
  };

  // Attach recent ingest error digests (safe if table missing)
  try {
    summary.errors = await getSourceErrorDigests(wh);
  } catch (e: unknown) {
    if (getPgCode(e) !== "42P01") {
      console.warn("[adminHealth] getSourceErrorDigests failed:", getErrorMessage(e));
    }
    summary.errors = [];
  }

  // (Optional) override perSourceIngest with window-scoped rollup if needed
  try {
    type R = {
      source_id: number | null;
      source: string | null;
      allowed: boolean | null;
      rss_url: string | null;
      homepage_url: string | null;
      inserted: string;
      updated: string;
      skipped: string;
      last_at: string | null;
    };

    const resIngest = await dbQuery<R>(
      `
      WITH win AS (
        SELECT *
        FROM ingest_logs
        WHERE created_at >= NOW() - ($1::int || ' hours')::interval
      )
      SELECT
        COALESCE(w.source_id, 0)                       AS source_id,
        s.name                                         AS source,
        s.allowed,
        s.rss_url,
        s.homepage_url,
        SUM(CASE WHEN w.reason IN ('ok_insert','inserted') THEN 1 ELSE 0 END)::bigint AS inserted,
        SUM(CASE WHEN w.reason IN ('ok_update','updated') THEN 1 ELSE 0 END)::bigint AS updated,
        SUM(CASE WHEN w.reason IN ('invalid_item','skipped') OR w.reason LIKE 'skip_%' THEN 1 ELSE 0 END)::bigint AS skipped,
        MAX(w.created_at)                              AS last_at
      FROM win w
      LEFT JOIN sources s ON s.id = w.source_id
      GROUP BY COALESCE(w.source_id, 0), s.name, s.allowed, s.rss_url, s.homepage_url
      ORDER BY 1
      `,
      [wh]
    );
    const ingestRows = toRows<R>(resIngest);

    summary.perSourceIngest = ingestRows
      .filter((r) => Number(r.source_id ?? 0) > 0)
      .map((r): PerSourceIngestRow => ({
        source_id: Number(r.source_id ?? 0),
        source: r.source ?? `#${r.source_id}`,
        allowed: r.allowed,
        rss_url: r.rss_url,
        homepage_url: r.homepage_url,
        inserted: Number(r.inserted ?? 0),
        updated: Number(r.updated ?? 0),
        skipped: Number(r.skipped ?? 0),
        lastAt: r.last_at ?? null,
      }));
  } catch {
    summary.perSourceIngest = summary.perSourceIngest ?? [];
  }

  return summary;
}

/** Roll up recent ingest errors (fetch/parse) within the window. */
export async function getSourceErrorDigests(windowHours = 72): Promise<ErrorDigest[]> {
  const wh = clampHours(windowHours);

  const res = await dbQuery<{
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
  );

  const rows = toRows<{
    source_id: number;
    source: string | null;
    rss_url: string | null;
    homepage_url: string | null;
    allowed: boolean | null;
    total: string;
    last_at: string | null;
    last_detail: string | null;
    sample_url: string | null;
  }>(res);

  return rows.map((r): ErrorDigest => {
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
