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
  // we exclude player pages in the WHERE, but keep the field for completeness
  is_player_page?: boolean | null;
};

export type FetchSectionOpts = {
  key: SectionKey | "";  // allow "" when you want raw list (rare)
  limit?: number;
  offset?: number;
  days?: number;
  week?: number | null;
  provider?: string;     // e.g., "espn.com" (normalized without "www.")
  sourceId?: number;
  perProviderCap?: number; // cap per provider for interleaving
  sport?: string;
};

/** Shared provider-interleaved, primary-topic-only query used by API and HomeData. */
export async function fetchSectionItems(opts: FetchSectionOpts): Promise<SectionRow[]> {
  const key = opts.key;
  const limit = Math.max(1, Math.min(opts.limit ?? 12, 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const days = Math.max(1, Math.min(opts.days ?? 45, 365));
  const week = typeof opts.week === "number" ? Math.max(0, Math.min(opts.week, 30)) : null;
  // Per-provider cap: default = floor(limit/3), min 1, max 10
  const defaultCap = Math.max(1, Math.floor(limit / 3));
  const rawCap = opts.perProviderCap ?? defaultCap;
  const perProviderCap = Math.max(1, Math.min(rawCap, 10));

  // Provider comes from sources.provider (not URL host)
  const provider = (opts.provider ?? "").toLowerCase().trim();
  const sourceId = opts.sourceId;
  const sport = (opts.sport ?? "").toLowerCase().trim();

  const params: unknown[] = [];
  let p = 0;
  const push = (v: unknown) => { params.push(v); return ++p; };

  const where: string[] = [];
  where.push(`a.discovered_at >= NOW() - ($${push(days)} || ' days')::interval`);
  where.push(`COALESCE(a.is_player_page, false) = false`);
  if (typeof sourceId === "number") where.push(`a.source_id = $${push(sourceId)}`);
  if (sport) where.push(`LOWER(a.sport) = $${push(sport)}`);

  // NEW: provider filter uses sources.provider (not URL host)
  if (provider) where.push(`LOWER(COALESCE(s.provider, '')) = $${push(provider)}`);

  const restrictToTopic = Boolean(key && key !== "news");
  const isNews = key === "news";

  const sql = `
    WITH canon(ordering) AS (
      SELECT ARRAY['start-sit','waiver-wire','injury','dfs','rankings','advice','news']::text[]
    ),
    base AS (
      SELECT
        a.*,
        s.name      AS source,
        s.provider  AS provider,                          -- ← expose provider from sources
        LOWER(COALESCE(NULLIF(s.provider,''), s.name)) AS provider_key  -- ← key for interleave/cap
      FROM articles a
      JOIN sources  s ON s.id = a.source_id
      , canon c
      WHERE ${where.join(" AND ")}
      ${
        restrictToTopic ? `
        AND a.topics @> ARRAY[$${push(key)}]::text[]
        AND array_position(c.ordering, $${push(key)}) = (
          SELECT MIN(array_position(c.ordering, t))
          FROM unnest(a.topics) AS t
          WHERE t = ANY (c.ordering)
        )` : isNews ? `
        AND (
          a.topics IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM unnest(a.topics) AS t
            WHERE t = ANY (c.ordering) AND t <> 'news'
          )
        )` : ``
      }
      ${week !== null ? `AND a.week = $${push(week)}` : ``}
    ),
    ranked AS (
      SELECT
        b.*,
        ROW_NUMBER() OVER (                          -- ← cap/interleave BY PROVIDER
          PARTITION BY b.provider_key
          ORDER BY b.published_at DESC NULLS LAST, b.id DESC
        ) AS rnk
      FROM base b
    )
    SELECT
      id, title, url, canonical_url, domain, image_url,
      published_at, discovered_at, source, topics, week
    FROM ranked
    WHERE rnk <= $${push(perProviderCap)}
    ORDER BY rnk, published_at DESC NULLS LAST, id DESC
    LIMIT $${push(limit)} OFFSET $${push(offset)}
  `;

  return dbQueryRows<SectionRow>(sql, params);
}