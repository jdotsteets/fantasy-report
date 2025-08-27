// lib/homeData.ts
// Server-side data accessor: call DB directly (no self-fetching).
// Uses your `is_player_page` column and a robust label compiler (no `any`).

import { dbQuery } from "@/lib/db";

// --------------------------- Types ------------------------------------------

export type HomeParams = {
  sport: "nfl";            // reserved for future
  days: number;            // lookback window
  week?: number | null;    // optional NFL week (we'll use it for WAIVERS only)
  limitNews: number;
  limitRankings: number;
  limitStartSit: number;
  limitAdvice: number;
  limitDFS: number;
  limitWaivers: number;
  limitInjuries: number;
  limitHero: number;
};

export type DbRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string;
  image_url: string | null;
  published_at: string | null;
  discovered_at: string | null;
  week: number | null;
  topics: string[] | null;
  source: string;
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

type SqlValue = string | number | boolean | null;

// ---------------- Label compiler (overlap-safe) -----------------------------

function compileLabeledSql(
  template: string,
  bindings: ReadonlyArray<{ label: string; value: SqlValue }>
): { sql: string; params: SqlValue[] } {
  const byLabel = new Map<string, SqlValue>();
  for (const b of bindings) byLabel.set(b.label, b.value);
  const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length);

  let sql = "";
  const params: SqlValue[] = [];

  for (let i = 0; i < template.length; ) {
    if (template[i] !== "$") { sql += template[i++]; continue; }
    let matched: string | null = null;
    for (const lab of labels) if (template.startsWith(lab, i)) { matched = lab; break; }
    if (matched) {
      params.push(byLabel.get(matched) as SqlValue);
      sql += `$${params.length}`;
      i += matched.length;
    } else {
      sql += template[i++]; // literal '$'
    }
  }
  return { sql, params };
}

// --------------------------- SQL helpers ------------------------------------

function primaryTopicExpr(alias = "a"): string {
  return `
    COALESCE(${alias}.primary_topic,
      CASE
        WHEN ${alias}.topics && ARRAY['sleepers']::text[]     THEN 'sleepers'
        WHEN ${alias}.topics && ARRAY['waiver-wire']::text[]  THEN 'waiver-wire'
        WHEN ${alias}.topics && ARRAY['rankings']::text[]     THEN 'rankings'
        WHEN ${alias}.topics && ARRAY['injury']::text[]       THEN 'injury'
        WHEN ${alias}.topics && ARRAY['start-sit']::text[]    THEN 'start-sit'
        WHEN ${alias}.topics && ARRAY['dfs']::text[]          THEN 'dfs'
        WHEN ${alias}.topics && ARRAY['advice']::text[]       THEN 'advice'
        ELSE NULL
      END
    )
  `;
}

/**
 * Build a parameterized section query. It:
 *  - applies time window (& optional per-section week)
 *  - filters out player pages via `a.is_player_page IS NOT TRUE`
 *  - restricts NBCSports to /nfl/
 *  - gates 3135/3138/3141 to NFL/Fantasy-Football keywords
 *  - dedupes by canonical_url/url
 *  - returns newest first
 */
function buildSectionSql(topic: string | null): string {
  const pTopic = primaryTopicExpr("a");
  const topicWhere =
    topic === null
      ? `(${pTopic} IS NULL)`            // News & Updates (general)
      : `(${pTopic} = $TOPIC)`;          // specific section

  return `
    WITH filtered AS (
      SELECT
        a.id,
        COALESCE(a.cleaned_title, a.title) AS title,
        a.url,
        a.canonical_url,
        a.domain,
        a.image_url,
        a.published_at,
        a.discovered_at,
        a.week,
        a.topics,
        s.name AS source,
        COALESCE(a.published_at, a.discovered_at) AS order_ts
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE
        -- time window
        (a.published_at >= NOW() - ($DAYS || ' days')::interval
          OR a.discovered_at >= NOW() - ($DAYS || ' days')::interval)
        -- optional per-section week (NULL means "no week filter")
        AND ($WEEK::int IS NULL OR a.week = $WEEK)

        -- exclude player pages
        AND a.is_player_page IS NOT TRUE

        -- keep NBCSports to NFL only (soccer, etc. out)
        AND NOT (a.domain ILIKE '%nbcsports.com%' AND a.url NOT ILIKE '%/nfl/%')

        -- Gate selected sources to NFL/fantasy-football keywords in title or url
        AND (
          a.source_id NOT IN (3135, 3138, 3141) OR (
            COALESCE(a.cleaned_title, a.title) ILIKE $NFL
            OR a.url ILIKE $NFL_URL
            OR COALESCE(a.cleaned_title, a.title) ILIKE $FF
            OR a.url ILIKE $FF_URL
          )
        )

        -- Topic selection
        AND ${topicWhere}
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(canonical_url, url)
               ORDER BY order_ts DESC NULLS LAST, id DESC
             ) AS rn
      FROM filtered
    )
    SELECT id, title, url, canonical_url, domain, image_url, published_at, discovered_at, week, topics, source
    FROM ranked
    WHERE rn = 1
    ORDER BY COALESCE(published_at, discovered_at) DESC NULLS LAST, id DESC
    LIMIT $LIMIT
  `;
}

async function fetchSection(
  topic: string | null,
  days: number,
  weekForSection: number | null,
  limit: number
): Promise<DbRow[]> {
  const NFL = "%nfl%";
  const FF  = "%fantasy%football%";

  const template = buildSectionSql(topic);

  const { sql, params } = compileLabeledSql(template, [
    { label: "$DAYS",     value: String(days) },
    { label: "$WEEK",     value: weekForSection }, // <-- per-section week
    { label: "$NFL_URL",  value: NFL },
    { label: "$NFL",      value: NFL },
    { label: "$FF_URL",   value: FF },
    { label: "$FF",       value: FF },
    ...(topic !== null ? [{ label: "$TOPIC", value: topic }] as const : []),
    { label: "$LIMIT",    value: limit },
  ]);

  const res = await dbQuery<DbRow>(sql, params);
  return res.rows;
}

// --------------------------- Public entry -----------------------------------

export async function getHomeData(p: HomeParams): Promise<HomePayload> {
  const week = p.week ?? null;

  // Only WAIVER WIRE is filtered by the upcoming week.
  const latest     = await fetchSection(null,          p.days, null,       p.limitNews);
  const rankings   = await fetchSection("rankings",    p.days, null,       p.limitRankings);
  const startSit   = await fetchSection("start-sit",   p.days, null,       p.limitStartSit);
  const advice     = await fetchSection("advice",      p.days, null,       p.limitAdvice);
  const dfs        = await fetchSection("dfs",         p.days, null,       p.limitDFS);
  const waivers    = await fetchSection("waiver-wire", p.days, week,       p.limitWaivers);
  const injuries   = await fetchSection("injury",      p.days, null,       p.limitInjuries);

  const heroCandidates = latest.slice(0, p.limitHero);

  return {
    items: {
      latest,
      rankings,
      startSit,
      advice,
      dfs,
      waivers,
      injuries,
      heroCandidates,
    },
  };
}
