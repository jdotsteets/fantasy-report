// lib/sectionsQuery.ts
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
  source: string | null;   // human-readable source name from `sources`
  topics: string[] | null;
  week: number | null;
  is_player_page?: boolean | null;
};

export type FetchSectionOpts = {
  key: SectionKey | "";   // "" treated like 'news'
  limit?: number;
  offset?: number;
  days?: number;
  week?: number | null;
  provider?: string;      // name or domain fragment (lowercased)
  sourceId?: number;
  perProviderCap?: number;
  sport?: string;
  maxAgeHours?: number;   // extra freshness clamp for 'news'
};

function newsPredicateSQL(): string {
  // Include NULL, explicit 'news', and anything not in the six buckets
  return `(
    a.primary_topic IS NULL
    OR a.primary_topic = 'news'
    OR a.primary_topic NOT IN ('rankings','start-sit','waiver-wire','dfs','injury','advice')
  )`;
}

/** Shared provider-interleaved query used by API and HomeData. */
export async function fetchSectionItems(opts: FetchSectionOpts): Promise<SectionRow[]> {
  const limit  = Math.max(1, Math.min(opts.limit ?? 12, 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const days   = Math.max(1, Math.min(opts.days ?? 45, 365));
  const week   = typeof opts.week === "number" ? Math.max(0, Math.min(opts.week, 30)) : null;

  const maxPerProvider = Math.max(1, Math.min(opts.perProviderCap ?? 2, 10));
  const provider = (opts.provider ?? "").toLowerCase().trim();
  const sourceId = opts.sourceId;
  const sport    = (opts.sport ?? "nfl").toLowerCase().trim();

  const key = opts.key || "news";
  const isNews = key === "news";
  const newsMaxAgeHours = Math.max(1, Math.min(opts.maxAgeHours ?? 72, 24 * 14));

  const params: Array<string | number> = [];
  let p = 0;
  const push = (v: string | number) => { params.push(v); return ++p; };

  const where: string[] = [];
  // Sport
  where.push(`LOWER(a.sport) = $${push(sport)}`);
  // Window uses COALESCE so rows missing published_at still show
  where.push(`COALESCE(a.published_at, a.discovered_at) >= NOW() - ($${push(days)} || ' days')::interval`);
  // Exclude player pages
  where.push(`COALESCE(a.is_player_page, false) = false`);
  // Block explicit URLs (apply to all sections)
  where.push(`NOT EXISTS (SELECT 1 FROM blocked_urls b WHERE b.url = a.canonical_url)`);

  if (typeof sourceId === "number") {
    where.push(`a.source_id = $${push(sourceId)}`);
  }

  if (provider) {
    // allow matching by domain, provider field, or fuzzy source name
    const i1 = push(provider);
    const i2 = push(provider);
    const i3 = push(provider);
    where.push(`(
      LOWER(COALESCE(a.domain,'')) = $${i1}
      OR LOWER(COALESCE(s.provider,'')) = $${i2}
      OR LOWER(COALESCE(s.name,'')) ILIKE '%' || $${i3} || '%'
    )`);
  }

  // Section filtering
  if (!isNews) {
    const idx = push(key);
    // Prefer primary_topic, but allow topics array to satisfy as a fallback
    where.push(`(
      a.primary_topic = $${idx}
      OR (a.topics IS NOT NULL AND a.topics @> ARRAY[$${idx}]::text[])
    )`);
  } else {
    where.push(newsPredicateSQL());
    // optional extra freshness for headlines
    where.push(`COALESCE(a.published_at, a.discovered_at) >= NOW() - ($${push(newsMaxAgeHours)} || ' hours')::interval`);
  }

  const typedKey = (opts.key || "news") as SectionKey | "news";
  const isStartSit = typedKey === "start-sit";
  const supportsWeek = typedKey === "waiver-wire" || typedKey === "start-sit"; // only Waiver Wire should use week

  const prefWeek = typeof opts.week === "number" ? opts.week : 0;
  const prefWeekIdx = push(prefWeek);

  if (supportsWeek && week !== null) {
    where.push(`a.week = $${push(week)}`);
  }

  const orderSql = isNews
    ? `ORDER BY pub_ts DESC NULLS LAST, id DESC`
    : isStartSit
    ? `ORDER BY wk_rank DESC, pub_ts DESC NULLS LAST, id DESC`
    : `ORDER BY
         rnk,
         ((pidx + rnk) % uniq),
         pub_ts DESC NULLS LAST,
         id DESC`;

  const sql = `
    WITH canon(ordering) AS (
      SELECT ARRAY['start-sit','waiver-wire','injury','dfs','rankings','advice','news']::text[]
    ),
    base AS (
      SELECT
        a.*,
        s.name     AS source,
        s.provider AS provider,
        LOWER(COALESCE(NULLIF(s.provider,''), s.name)) AS provider_key,
        COALESCE(a.published_at, a.discovered_at) AS pub_ts
        , CASE
          WHEN $${prefWeekIdx} > 0 AND a.week = $${prefWeekIdx}       THEN 4   -- Week N
          WHEN $${prefWeekIdx} > 0 AND a.week = $${prefWeekIdx} - 1   THEN 2   -- Week N-1 (early week filler)
          WHEN a.week IS NULL                                         THEN 1   -- unknown week is OK-ish
          ELSE 0
        END AS wk_rank
      FROM articles a
      JOIN sources  s ON s.id = a.source_id
      , canon c
      WHERE ${where.join(" AND ")}
    ),
    uniq AS (
      SELECT GREATEST(COUNT(DISTINCT provider_key), 1) AS n FROM base
    ),
    ranked AS (
      SELECT
        b.*,
        ROW_NUMBER() OVER (
          PARTITION BY b.provider_key
          ORDER BY b.pub_ts DESC NULLS LAST, b.id DESC
        ) AS rnk,
        DENSE_RANK() OVER (ORDER BY b.provider_key) - 1 AS pidx
      FROM base b
    ),
    capped AS (
      SELECT
        r.*,
        u.n AS uniq,
        LEAST($${push(maxPerProvider)}, GREATEST(1, CEIL($${push(limit)}::numeric / u.n))) AS cap
      FROM ranked r
      CROSS JOIN uniq u
    )
    SELECT
      id, title, url, canonical_url, domain, image_url,
      published_at, discovered_at, source, topics, week
    FROM capped
    WHERE rnk <= cap
    ${orderSql}
    LIMIT $${push(limit)} OFFSET $${push(offset)};
  `;

  return dbQueryRows<SectionRow>(sql, params);
}
