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
  const provider = (opts.provider ?? "").toLowerCase().replace(/^www\./, "").trim();
  const sourceId = opts.sourceId;
  const perProviderCap = Math.max(1, Math.min(opts.perProviderCap ?? Math.floor(limit / 3)) || 1, 10);

  const params: unknown[] = [];
  let p = 0;
  const push = (v: unknown) => { params.push(v); return ++p; };

  const where: string[] = [];
  where.push(`a.discovered_at >= NOW() - ($${push(days)} || ' days')::interval`);
  where.push(`COALESCE(a.is_player_page, false) = false`);

  if (typeof sourceId === "number") where.push(`a.source_id = $${push(sourceId)}`);

  if (provider) {
    // normalize provider from domain/host (strip "www.")
    where.push(`
      COALESCE(
        NULLIF(LOWER(REGEXP_REPLACE(a.domain, '^www\\.', '')), ''),
        LOWER(REGEXP_REPLACE(substring(a.canonical_url from 'https?://([^/]+)'), '^www\\.', '')),
        LOWER(REGEXP_REPLACE(substring(a.url          from 'https?://([^/]+)'), '^www\\.', ''))
      ) = $${push(provider)}
    `);
  }

  const restrictToTopic = Boolean(key && key !== "news");
  const isNews = key === "news";
  

  const sql = `
    WITH canon(ordering) AS (
      SELECT ARRAY[${ORDERED_SECTIONS.map(s => `'${s}'`).join(",")}]::text[]
    ),
    base AS (
      SELECT
        a.*,
        s.name AS source,
        -- normalize provider key from domain/host (strip www.)
        COALESCE(
          NULLIF(LOWER(REGEXP_REPLACE(a.domain, '^www\\.', '')), ''),
          LOWER(REGEXP_REPLACE(substring(a.canonical_url from 'https?://([^/]+)'), '^www\\.', '')),
          LOWER(REGEXP_REPLACE(substring(a.url          from 'https?://([^/]+)'), '^www\\.', ''))
        ) AS provider_key
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      , canon c
      WHERE ${where.join(" AND ")}
      ${
        restrictToTopic
          ? `
        -- Only rows whose canonical *primary* topic == $key
        AND a.topics @> ARRAY[$${push(key)}]::text[]
        AND array_position(c.ordering, $${push(key)}) = (
          SELECT MIN(array_position(c.ordering, t))
          FROM unnest(a.topics) AS t
          WHERE t = ANY (c.ordering)
        )`
          : isNews
          ? `
        -- "news" = rows with no canonical topic
        AND (
          a.topics IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM unnest(a.topics) AS t
            WHERE t = ANY (c.ordering) AND t <> 'news'
          )
        )`
          : ``
      }
      ${week !== null ? `AND a.week = $${push(week)}` : ``}
    ),
    ranked AS (
      SELECT
        b.*,
        ROW_NUMBER() OVER (
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
