// lib/excludedData.ts
import { dbQuery } from "@/lib/db";

export type ExcludedParams = {
  days?: number;   // lookback window (default 21)
  limit?: number;  // max rows (default 200)
  reason?: string | null; // optional: only show one reason
};

export type ExcludedRow = {
  id: number;
  title: string;
  url: string;
  domain: string;
  source: string;
  published_at: string | null;
  discovered_at: string | null;
  reasons: string[]; // computed
};

export type IngestLogRow = {
  id: number;
  source: string;
  domain: string;
  url: string;
  title: string | null;
  reason: "blocked_by_filter" | "non_nfl_league" | "invalid_item" | "fetch_error";
  detail: string | null;
  created_at: string;
};



export async function getIngestLogs(days = 7, limit = 200): Promise<IngestLogRow[]> {
  const sql = `
    SELECT l.id,
           s.name AS source,
           REGEXP_REPLACE(l.url, '^https?://(?:www\\.)?([^/]+).*$', '\\1') AS domain,
           l.url, l.title, l.reason, l.detail, l.created_at
    FROM ingest_skips l
    JOIN sources s ON s.id = l.source_id
    WHERE l.created_at >= NOW() - ($1 || ' days')::interval
    ORDER BY l.created_at DESC
    LIMIT $2
  `;
  const res = await dbQuery<IngestLogRow>(sql, [String(days), limit]);
  return res.rows;
}

// reason keys are stable and can be filtered in UI
// - player_page          : is_player_page = true
// - nbc_non_nfl          : nbcsports item not under /nfl/
// - fp_player_util       : fantasypros php/player/»
// - html_in_title        : title contains HTML tags
// - category_index       : section/category/”Articles” hub pages
// - tool_or_landing      : lineup generator/optimizer/pass etc.
// - non_article_generic  : generic one/two-word titles like “DFS 101”

export async function getExcludedItems(p: ExcludedParams = {}): Promise<ExcludedRow[]> {
  const days = p.days ?? 21;
  const limit = Math.min(Math.max(p.limit ?? 200, 1), 500);

  // NOTE: keep these in sync with contentFilter + homeData rules
  const sql = `
    WITH base AS (
      SELECT
        a.id,
        COALESCE(a.cleaned_title, a.title) AS title,
        a.url,
        a.domain,
        s.name AS source,
        a.published_at,
        a.discovered_at,

        -- Reason flags
        (a.is_player_page IS TRUE) AS r_player_page,

        (a.domain ILIKE '%nbcsports.com%'
          AND a.url NOT ILIKE '%/nfl/%') AS r_nbc_non_nfl,

        (a.domain ILIKE '%fantasypros.com%'
          AND (
            COALESCE(a.cleaned_title, a.title) LIKE '» %'
            OR a.url ~* '/nfl/(players|stats|news)/[a-z0-9-]+\\.php$'
          )
        ) AS r_fp_player_util,

        (COALESCE(a.cleaned_title, a.title) ~* '<[^>]+>') AS r_html_in_title,

        (
          -- category or tag landing pages without dated article paths
          a.url ~* '/(category|categories|tag|topics?|news|articles)(/|$)'
          AND a.url !~* '/20\\d{2}/\\d{2}/\\d{2}/'
        ) OR
        (
          COALESCE(a.cleaned_title, a.title) ~* '\\bArticles\\b'
          OR COALESCE(a.cleaned_title, a.title) ~* 'News \\(free only\\)'
        ) AS r_category_index,

        (
          -- lineup tools / passes / optimizers (footballguys + fantasyfootballers)
          COALESCE(a.cleaned_title, a.title) ~* '\\b(DFS Pass|Lineup Generator|Multi Lineup Optimizer|Single Lineup Builder)\\b'
          OR a.url ~* '/(dfs-?pass|lineup|optimizer|builder)(/|$)'
        ) AS r_tool_or_landing,

        (
          -- very generic titles that are almost certainly hubs
          COALESCE(a.cleaned_title, a.title) ~* '^(DFS 101|DFS Articles|Articles)$'
        ) AS r_non_article_generic

      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE COALESCE(a.published_at, a.discovered_at) >= NOW() - ($1 || ' days')::interval
    ),
    reasons AS (
      SELECT
        id, title, url, domain, source, published_at, discovered_at,
        ARRAY_REMOVE(ARRAY[
          CASE WHEN r_player_page THEN 'player_page' END,
          CASE WHEN r_nbc_non_nfl THEN 'nbc_non_nfl' END,
          CASE WHEN r_fp_player_util THEN 'fp_player_util' END,
          CASE WHEN r_html_in_title THEN 'html_in_title' END,
          CASE WHEN r_category_index THEN 'category_index' END,
          CASE WHEN r_tool_or_landing THEN 'tool_or_landing' END,
          CASE WHEN r_non_article_generic THEN 'non_article_generic' END
        ], NULL) AS reasons
      FROM base
    )
    SELECT *
    FROM reasons
    WHERE array_length(reasons, 1) IS NOT NULL
      ${p.reason ? "AND $2 = ANY(reasons)" : ""}
    ORDER BY COALESCE(published_at, discovered_at) DESC NULLS LAST, id DESC
    LIMIT ${p.reason ? "$3" : "$2"}
  `;

  const params = p.reason ? [String(days), p.reason, limit] : [String(days), limit];
  const res = await dbQuery<ExcludedRow>(sql, params);
  return res.rows;
}
