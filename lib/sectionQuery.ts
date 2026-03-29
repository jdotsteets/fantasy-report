// lib/sectionQuery.ts
import { dbQueryRows } from "@/lib/db";

export const ORDERED_SECTIONS = [
  "start-sit",
  "waiver-wire",
  "injury",
  "dfs",
  "rankings",
  "advice",
  "news",
  "nfl-draft",
  "free-agency",
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
  summary: string | null;
  fantasy_impact_label: string | null;
  fantasy_impact_confidence: number | null;
  is_player_page?: boolean | null;
  primary_topic: string | null;
  secondary_topic: string | null;
  score: number | null;
};

export type FetchSectionOpts = {
  key: SectionKey | "";
  limit?: number;
  offset?: number;
  days?: number;
  week?: number | null;
  provider?: string;
  sourceId?: number;
  perProviderCap?: number | null;
  sport?: string;
  maxAgeHours?: number;
  staticMode?: "exclude" | "only" | "any";
  staticType?: string | null;
};

function newsPredicateSQL(): string {
  return `(
    a.primary_topic IS NULL
    OR a.primary_topic = 'news'
    OR a.primary_topic NOT IN (
      'rankings',
      'start-sit',
      'waiver-wire',
      'dfs',
      'injury',
      'advice',
      'nfl-draft',
      'free-agency'
    )
  )`;
}

export async function fetchSectionItems(opts: FetchSectionOpts): Promise<SectionRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 12, 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const days = Math.max(1, Math.min(opts.days ?? 45, 365));
  const week = typeof opts.week === "number" ? Math.max(0, Math.min(opts.week, 30)) : null;

  const providerRaw = (opts.provider ?? "").trim();
  const provider = providerRaw.length > 0 ? providerRaw : "";
  const sourceId = opts.sourceId;
  const sport = (opts.sport ?? "nfl").toLowerCase().trim();

  const key = opts.key || "news";
  const isNews = key === "news";
  const newsMaxAgeHours = Math.max(1, Math.min(opts.maxAgeHours ?? 72, 24 * 14));

  const staticMode: "exclude" | "only" | "any" = opts.staticMode ?? "exclude";
  const staticType = (opts.staticType ?? "").trim() || null;

  const hasProviderFilter = Boolean(provider) || typeof sourceId === "number";

  const perProviderCap: number | null = hasProviderFilter
    ? null
    : opts.perProviderCap === null
      ? null
      : opts.perProviderCap === undefined
        ? 3
        : Math.max(1, Math.min(opts.perProviderCap, 10));

  const params: Array<string | number> = [];
  let p = 0;

  const push = (value: string | number): number => {
    params.push(value);
    p += 1;
    return p;
  };

  const where: string[] = [];
  where.push(`LOWER(a.sport) = $${push(sport)}`);

  // Use freshest available timestamp for filtering
  where.push(
    `COALESCE(a.published_at, a.discovered_at) >= NOW() - ($${push(days)} || ' days')::interval`,
  );

  where.push(`COALESCE(a.is_player_page, false) = false`);
  where.push(`NOT EXISTS (SELECT 1 FROM blocked_urls b WHERE b.url = a.canonical_url)`);

  if (staticMode === "exclude") {
    where.push(`a.is_static IS DISTINCT FROM true`);
  } else if (staticMode === "only") {
    where.push(`a.is_static IS TRUE`);
  }

  if (staticType) {
    where.push(`a.static_type = ${push(staticType)}`);
  }

  if (typeof sourceId === "number") {
    where.push(`a.source_id = ${push(sourceId)}`);
  }

  if (provider) {
    where.push(`s.provider ILIKE ${push(provider)}`);
  }

  if (isNews) {
    where.push(newsPredicateSQL());
    where.push(
      `COALESCE(a.published_at, a.discovered_at) >= NOW() - (${push(newsMaxAgeHours)} || ' hours')::interval`,
    );
  } else {
    const idx = push(key);
    where.push(`(
      a.primary_topic = ${idx}
      OR a.secondary_topic = ${idx}
      OR (a.topics IS NOT NULL AND a.topics @> ARRAY[${idx}]::text[])
    )`);
  }

  if (week !== null && (key === "waiver-wire" || key === "start-sit")) {
    where.push(`a.week = ${push(week)}`);
  }

  const baseSelect = `
    SELECT
      a.id,
      a.title,
      a.url,
      a.canonical_url,
      a.domain,
      a.image_url,
      a.published_at,
      a.discovered_at,
      a.topics,
      a.week,
      a.summary,
      a.fantasy_impact_label,
      a.fantasy_impact_confidence,
      a.primary_topic,
      a.secondary_topic,
      a.sport,
      a.is_player_page,
      a.is_static,
      a.static_type,
      a.source_id,
      s.name AS source,
      s.provider AS provider,
      LOWER(COALESCE(NULLIF(s.provider, ''), s.name)) AS provider_key,
      COALESCE(a.published_at, a.discovered_at) AS sort_ts
    FROM articles a
    JOIN sources s
      ON s.id = a.source_id
    WHERE ${where.join(" AND ")}
  `;

  const sql =
    perProviderCap && perProviderCap > 0
      ? `
        WITH base AS (
          ${baseSelect}
        ),
        ranked AS (
          SELECT
            b.*,
            ROW_NUMBER() OVER (
              PARTITION BY b.provider_key
              ORDER BY b.sort_ts DESC NULLS LAST, b.id DESC
            ) AS rnk_all,
            DATE_TRUNC('day', b.sort_ts) AS sort_day,
            ROW_NUMBER() OVER (
              PARTITION BY b.provider_key, DATE_TRUNC('day', b.sort_ts)
              ORDER BY b.sort_ts DESC NULLS LAST, b.id DESC
            ) AS rnk_day,
            DENSE_RANK() OVER (
              PARTITION BY DATE_TRUNC('day', b.sort_ts)
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
          id,
          title,
          url,
          canonical_url,
          domain,
          image_url,
          published_at,
          discovered_at,
          source,
          topics,
          week,
          summary,
          fantasy_impact_label,
          fantasy_impact_confidence,
          primary_topic,
          secondary_topic
        FROM capped
        ORDER BY
          sort_day DESC,
          rnk_day ASC,
          pidx_day ASC,
          sort_ts DESC NULLS LAST,
          id DESC
        LIMIT $${push(limit)} OFFSET $${push(offset)};
      `
      : `
        WITH base AS (
          ${baseSelect}
        )
        SELECT
          id,
          title,
          url,
          canonical_url,
          domain,
          image_url,
          published_at,
          discovered_at,
          source,
          topics,
          week,
          summary,
          fantasy_impact_label,
          fantasy_impact_confidence,
          primary_topic,
          secondary_topic
        FROM base
        ORDER BY
          sort_ts DESC NULLS LAST,
          id DESC
        LIMIT $${push(limit)} OFFSET $${push(offset)};
      `;

  const rows = await dbQueryRows<SectionRow>(sql, params);

  const badTitlePattern = /\b(radio|broadcast|coverage|station)\b/i;

  const waiverTitleOk = (title: string): boolean =>
    /\b(waiver|wire|adds?|pickups?|stashes?)\b/i.test(title);

  const startSitTitleOk = (title: string): boolean =>
    /(start\/sit|start-?sit|who (to|should i) start|lineup decisions|sit\/start)/i.test(title);

  let filtered = rows.filter((row) => {
    const title = (row.title ?? "").toLowerCase();
    if (badTitlePattern.test(title)) return false;

    const topicsHasKey = Array.isArray(row.topics) && row.topics.includes(key);

    if (key === "waiver-wire") {
      if (!(topicsHasKey || waiverTitleOk(title))) return false;
    } else if (key === "start-sit") {
      if (!(topicsHasKey || startSitTitleOk(title))) return false;
    }

    return true;
  });

  if (perProviderCap && filtered.length < limit) {
    const uncapped = await fetchSectionItems({
      ...opts,
      perProviderCap: null,
      offset: 0,
      limit,
    });

    const seen = new Set(
      filtered.map((row) => (row.canonical_url || row.url || String(row.id)).toLowerCase()),
    );

    for (const row of uncapped) {
      const dedupeKey = (row.canonical_url || row.url || String(row.id)).toLowerCase();
      if (seen.has(dedupeKey)) continue;

      filtered.push(row);
      seen.add(dedupeKey);

      if (filtered.length >= limit) break;
    }
  }

  return filtered;
}