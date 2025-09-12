// lib/HomeData.ts
import { dbQuery } from "@/lib/db";

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
  sport: string;
  days: number;
  week?: number;
  sourceId?: number;
  provider?: string;
  limitNews: number;
  limitRankings: number;
  limitStartSit: number;
  limitAdvice: number;
  limitDFS: number;
  limitWaivers: number;
  limitInjuries: number;
  limitHero: number;
  perSourceCap?: number; // default 2
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

export async function getHomeData(p: HomeDataParams): Promise<HomePayload> {
  const {
    sport, days, week, sourceId, provider,
    limitNews, limitRankings, limitStartSit, limitAdvice, limitDFS,
    limitWaivers, limitInjuries, limitHero,
    perSourceCap = 2,
  } = p;

 const sql = `
  WITH filt AS (
    SELECT
      a.id, a.title, a.url, a.canonical_url, a.domain, a.image_url,
      a.published_at, a.discovered_at,
      s.name AS source,                    -- display name
      COALESCE(a.published_at, a.discovered_at) AS ts,
      a.primary_topic, a.topics, a.week
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE a.sport = $1::text
      AND (
        a.published_at    >= NOW() - ($2::text || ' days')::interval
        OR a.discovered_at >= NOW() - ($2::text || ' days')::interval
      )
      AND ($3::int  IS NULL OR a.source_id = $3::int)
      -- ✅ provider filter now uses sources.provider (not s.name)
      AND ($4::text IS NULL OR LOWER(s.provider) = LOWER($4::text))
  ),
  latest_pre AS (
    SELECT *, row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
    FROM filt
  ),
  latest AS (
    SELECT * FROM latest_pre WHERE rn <= $14::int ORDER BY ts DESC LIMIT $5::int
  ),
  rankings_pre AS (
    SELECT *, row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
    FROM filt
    WHERE primary_topic = 'rankings' OR 'rankings' = ANY(topics)
  ),
  rankings AS (
    SELECT * FROM rankings_pre WHERE rn <= $14::int ORDER BY ts DESC LIMIT $6::int
  ),
  start_sit_pre AS (
    SELECT *, row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
    FROM filt
    WHERE primary_topic = 'start-sit' OR 'start-sit' = ANY(topics)
  ),
  start_sit AS (
    SELECT * FROM start_sit_pre WHERE rn <= $14::int ORDER BY ts DESC LIMIT $7::int
  ),
  advice_pre AS (
    SELECT *, row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
    FROM filt
    WHERE primary_topic = 'advice' OR 'advice' = ANY(topics)
  ),
  advice AS (
    SELECT * FROM advice_pre WHERE rn <= $14::int ORDER BY ts DESC LIMIT $8::int
  ),
  dfs_pre AS (
    SELECT *, row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
    FROM filt
    WHERE primary_topic = 'dfs' OR 'dfs' = ANY(topics)
  ),
  dfs AS (
    SELECT * FROM dfs_pre WHERE rn <= $14::int ORDER BY ts DESC LIMIT $9::int
  ),
  waivers_pre AS (
    SELECT *, row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
    FROM filt
    WHERE (primary_topic = 'waiver-wire' OR 'waiver-wire' = ANY(topics))
      AND ($10::int IS NULL OR week = $10::int)
  ),
  waivers AS (
    SELECT * FROM waivers_pre WHERE rn <= $14::int ORDER BY ts DESC LIMIT $11::int
  ),
  injuries_pre AS (
    SELECT *, row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
    FROM filt
    WHERE primary_topic = 'injury' OR 'injury' = ANY(topics)
  ),
  injuries AS (
    SELECT * FROM injuries_pre WHERE rn <= $14::int ORDER BY ts DESC LIMIT $12::int
  ),
  hero AS (
    SELECT * FROM filt
    WHERE image_url IS NOT NULL
    ORDER BY ts DESC LIMIT $13::int
  )
  SELECT 'latest'::text AS bucket, to_jsonb(latest.*)        AS row FROM latest
  UNION ALL SELECT 'rankings',       to_jsonb(rankings.*)     FROM rankings
  UNION ALL SELECT 'startSit',       to_jsonb(start_sit.*)    FROM start_sit
  UNION ALL SELECT 'advice',         to_jsonb(advice.*)       FROM advice
  UNION ALL SELECT 'dfs',            to_jsonb(dfs.*)          FROM dfs
  UNION ALL SELECT 'waivers',        to_jsonb(waivers.*)      FROM waivers
  UNION ALL SELECT 'injuries',       to_jsonb(injuries.*)     FROM injuries
  UNION ALL SELECT 'heroCandidates', to_jsonb(hero.*)         FROM hero;
  `;

  const args: (string | number | null)[] = [
    sport,                // $1
    String(days),         // $2
    sourceId ?? null,     // $3
    provider ?? null,     // $4
    limitNews,            // $5
    limitRankings,        // $6
    limitStartSit,        // $7
    limitAdvice,          // $8
    limitDFS,             // $9
    week ?? null,         // $10
    limitWaivers,         // $11
    limitInjuries,        // $12
    limitHero,            // $13
    perSourceCap,         // $14
  ];

  const { rows } = await dbQuery<BucketRow>(sql, args, "home-data");

  const buckets: Record<string, DbRow[]> = {
    latest: [], rankings: [], startSit: [], advice: [], dfs: [], waivers: [], injuries: [], heroCandidates: [],
  };
  for (const r of rows) (buckets[r.bucket] ?? buckets.latest).push(r.row);

  return { items: buckets as HomePayload["items"] };
}
