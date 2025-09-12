// lib/HomeData.ts
import { dbQuery } from "@/lib/db";

/* ───────────────────────── Types ───────────────────────── */

export type DbRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  image_url: string | null;
  published_at: string | null;
  discovered_at: string | null;
  source: string | null;
};

export type HomeDataParams = {
  sport: string;   // e.g. "nfl"
  days: number;    // lookback window
  week?: number;   // for waiver-wire filter

  sourceId?: number;
  provider?: string;

  // per-section limits
  limitNews: number;
  limitRankings: number;
  limitStartSit: number;
  limitAdvice: number;
  limitDFS: number;
  limitWaivers: number;
  limitInjuries: number;
  limitHero: number;
};

export type HomePayload = {
  items: {
    latest: DbRow[];
    rankings: DbRow[];
    startSit: DbRow[];
    advice: DbRow[];
    dfs: DbRow[];
    waivers: DbRow[];
    injuries: DbRow[];
    heroCandidates: DbRow[];
  };
};

type BucketRow = { bucket: string; row: DbRow };

/* ───────────────────────── Query ───────────────────────── */

export async function getHomeData(p: HomeDataParams): Promise<HomePayload> {
  const {
    sport,
    days,
    week,
    sourceId,
    provider,
    limitNews,
    limitRankings,
    limitStartSit,
    limitAdvice,
    limitDFS,
    limitWaivers,
    limitInjuries,
    limitHero,
  } = p;

  // Single round-trip via CTEs; COALESCE(published_at, discovered_at) drives recency.
  const sql = `
    WITH filt AS (
      SELECT
        a.id, a.title, a.url, a.canonical_url, a.domain, a.image_url,
        a.published_at, a.discovered_at,
        s.name AS source,
        COALESCE(a.published_at, a.discovered_at) AS ts,
        a.primary_topic, a.topics, a.week
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE a.sport = $1::text
        AND (
          a.published_at  >= NOW() - ($2::text || ' days')::interval
          OR a.discovered_at >= NOW() - ($2::text || ' days')::interval
        )
        AND ($3::int  IS NULL OR a.source_id = $3::int)
        AND ($4::text IS NULL OR s.name     = $4::text)
    ),
    latest AS (
      SELECT * FROM filt
      ORDER BY ts DESC
      LIMIT $5::int
    ),
    rankings AS (
      SELECT * FROM filt
      WHERE primary_topic = 'rankings' OR 'rankings' = ANY(topics)
      ORDER BY ts DESC
      LIMIT $6::int
    ),
    start_sit AS (
      SELECT * FROM filt
      WHERE primary_topic = 'start-sit' OR 'start-sit' = ANY(topics)
      ORDER BY ts DESC
      LIMIT $7::int
    ),
    advice AS (
      SELECT * FROM filt
      WHERE primary_topic = 'advice' OR 'advice' = ANY(topics)
      ORDER BY ts DESC
      LIMIT $8::int
    ),
    dfs AS (
      SELECT * FROM filt
      WHERE primary_topic = 'dfs' OR 'dfs' = ANY(topics)
      ORDER BY ts DESC
      LIMIT $9::int
    ),
    waivers AS (
      SELECT * FROM filt
      WHERE (primary_topic = 'waiver-wire' OR 'waiver-wire' = ANY(topics))
        AND ($10::int IS NULL OR week = $10::int)
      ORDER BY ts DESC
      LIMIT $11::int
    ),
    injuries AS (
      SELECT * FROM filt
      WHERE primary_topic = 'injury' OR 'injury' = ANY(topics)
      ORDER BY ts DESC
      LIMIT $12::int
    ),
    hero AS (
      SELECT * FROM filt
      WHERE image_url IS NOT NULL
      ORDER BY ts DESC
      LIMIT $13::int
    )
    SELECT 'latest'::text          AS bucket, to_jsonb(latest.*)       AS row FROM latest
    UNION ALL SELECT 'rankings',    to_jsonb(rankings.*)                FROM rankings
    UNION ALL SELECT 'startSit',    to_jsonb(start_sit.*)               FROM start_sit
    UNION ALL SELECT 'advice',      to_jsonb(advice.*)                  FROM advice
    UNION ALL SELECT 'dfs',         to_jsonb(dfs.*)                     FROM dfs
    UNION ALL SELECT 'waivers',     to_jsonb(waivers.*)                 FROM waivers
    UNION ALL SELECT 'injuries',    to_jsonb(injuries.*)                FROM injuries
    UNION ALL SELECT 'heroCandidates', to_jsonb(hero.*)                 FROM hero;
  `;

  const args: (string | number | null)[] = [
    sport,
    String(days),
    sourceId ?? null,
    provider ?? null,
    limitNews,
    limitRankings,
    limitStartSit,
    limitAdvice,
    limitDFS,
    week ?? null,
    limitWaivers,
    limitInjuries,
    limitHero,
  ];

  const { rows } = await dbQuery<BucketRow>(sql, args, "home-data");

  const buckets: Record<string, DbRow[]> = {
    latest: [],
    rankings: [],
    startSit: [],
    advice: [],
    dfs: [],
    waivers: [],
    injuries: [],
    heroCandidates: [],
  };

  for (const r of rows) {
    const key = r.bucket in buckets ? r.bucket : "latest";
    buckets[key].push(r.row);
  }

  return {
    items: {
      latest: buckets.latest,
      rankings: buckets.rankings,
      startSit: buckets.startSit,
      advice: buckets.advice,
      dfs: buckets.dfs,
      waivers: buckets.waivers,
      injuries: buckets.injuries,
      heroCandidates: buckets.heroCandidates,
    },
  };
}
