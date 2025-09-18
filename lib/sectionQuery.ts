// lib/sectionQuery.ts
import type { QueryResult } from "pg";
import { dbQueryRows } from "@/lib/db";

export const ORDERED_SECTIONS = [
  "start-sit",
  "waiver-wire",
  "injury",
  "dfs",
  "rankings",
  "advice",
  "news",
] as const;

export type SectionKey = (typeof ORDERED_SECTIONS)[number];

export type SectionRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  image_url: string | null;
  published_at: string | null;
  discovered_at: string | null;
  source: string | null;
  topics: string[] | null;
  week: number | null;
  is_player_page?: boolean | null;
  // (optional) expose these later if you want:
  // is_static?: boolean | null;
  // static_type?: string | null;
};

export type FetchSectionOpts = {
  key: SectionKey | "";
  limit?: number;
  offset?: number;
  days?: number;
  week?: number | null;
  provider?: string;
  sourceId?: number;
  perProviderCap?: number;
  sport?: string;
  maxAgeHours?: number;

  /** NEW: control inclusion of static rows */
  staticMode?: "exclude" | "only" | "any"; // default: 'exclude'
  /** NEW: optionally scope by static_type (e.g. 'Projections') */
  staticType?: string | null;
};

function newsPredicateSQL(): string {
  return `(
    a.primary_topic IS NULL
    OR a.primary_topic = 'news'
    OR a.primary_topic NOT IN ('rankings','start-sit','waiver-wire','dfs','injury','advice')
  )`;
}

export async function fetchSectionItems(opts: FetchSectionOpts): Promise<SectionRow[]> {
  const limit  = Math.max(1, Math.min(opts.limit ?? 12, 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const days   = Math.max(1, Math.min(opts.days ?? 45, 365));
  const week   = typeof opts.week === "number" ? Math.max(0, Math.min(opts.week, 30)) : null;

  // hard cap: 3 per provider (can pass a lower number; never higher than 3)
  const perProviderCap = Math.max(1, Math.min(opts.perProviderCap ?? 3, 3));

  const provider = (opts.provider ?? "").toLowerCase().trim();
  const sourceId = opts.sourceId;
  const sport    = (opts.sport ?? "nfl").toLowerCase().trim();

  const key = opts.key || "news";
  const isNews = key === "news";
  const newsMaxAgeHours = Math.max(1, Math.min(opts.maxAgeHours ?? 72, 24 * 14));

  const staticMode: "exclude" | "only" | "any" = opts.staticMode ?? "exclude";
  const staticType = (opts.staticType ?? "").trim() || null;

  const params: Array<string | number> = [];
  let p = 0;
  const push = (v: string | number) => { params.push(v); return ++p; };

  const where: string[] = [];
  where.push(`LOWER(a.sport) = $${push(sport)}`);
  where.push(`a.published_at >= NOW() - ($${push(days)} || ' days')::interval`);
  where.push(`COALESCE(a.is_player_page, false) = false`);
  where.push(`NOT EXISTS (SELECT 1 FROM blocked_urls b WHERE b.url = a.canonical_url)`);

if (staticMode === "exclude") where.push(`a.is_static IS DISTINCT FROM true`);
else if (staticMode === "only") where.push(`a.is_static IS TRUE`);
  if (staticType) where.push(`a.static_type = $${push(staticType)}`);

  if (typeof sourceId === "number") where.push(`a.source_id = $${push(sourceId)}`);
  if (provider) {
    const i2 = push(provider);
    where.push(`LOWER(COALESCE(s.provider,'')) = $${i2}`);
  }

  if (isNews) {
    where.push(`(
      a.primary_topic IS NULL
      OR a.primary_topic = 'news'
      OR a.primary_topic NOT IN ('rankings','start-sit','waiver-wire','dfs','injury','advice')
    )`);
    where.push(`a.published_at >= NOW() - ($${push(newsMaxAgeHours)} || ' hours')::interval`);
  } else {
    const idx = push(key);
    where.push(`(
      a.primary_topic = $${idx}
      OR (a.topics IS NOT NULL AND a.topics @> ARRAY[$${idx}]::text[])
    )`);
  }

  // optional: only gate by week if provided (no weighting)
  if (week !== null && (key === "waiver-wire" || key === "start-sit")) {
    where.push(`a.week = $${push(week)}`);
  }

  const sql = `
    WITH base AS (
      SELECT
        a.*,
        s.name     AS source,
        s.provider AS provider,
        LOWER(COALESCE(NULLIF(s.provider,''), s.name)) AS provider_key,
        a.published_at AS pub_ts
      FROM articles a
      JOIN sources  s ON s.id = a.source_id
      WHERE ${where.join(" AND ")}
    ),

    ranked AS (
      SELECT
        b.*,
        -- global rank per provider (enforce cap of 3 across entire section)
        ROW_NUMBER() OVER (
          PARTITION BY b.provider_key
          ORDER BY b.pub_ts DESC NULLS LAST, b.id DESC
        ) AS rnk_all,

        -- day bucket + rank within provider for that day
        DATE_TRUNC('day', b.pub_ts) AS pub_day,
        ROW_NUMBER() OVER (
          PARTITION BY b.provider_key, DATE_TRUNC('day', b.pub_ts)
          ORDER BY b.pub_ts DESC NULLS LAST, b.id DESC
        ) AS rnk_day,

        -- provider index inside each day (for round-robin)
        DENSE_RANK() OVER (
          PARTITION BY DATE_TRUNC('day', b.pub_ts)
          ORDER BY b.provider_key
        ) - 1 AS pidx_day
      FROM base b
    ),

    capped AS (
      SELECT *
      FROM ranked
      WHERE rnk_all <= $${push(perProviderCap)}
    )

    SELECT
      id, title, url, canonical_url, domain, image_url,
      published_at, discovered_at, source, topics, week
    FROM capped
    ORDER BY
      pub_day DESC,          -- all of "today" before any "yesterday"
      rnk_day ASC,           -- 1st from each provider, then 2nd, then 3rd
      pidx_day ASC,          -- break ties to avoid consecutive providers
      pub_ts DESC NULLS LAST,
      id DESC
    LIMIT $${push(limit)} OFFSET $${push(offset)};
  `;

  return dbQueryRows<SectionRow>(sql, params);
}
