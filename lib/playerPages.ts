// lib/playerPages.ts
import { dbQuery } from "@/lib/db";

export type PlayerMatrixRow = {
  key: string;
  name: string;
  domain: string;
  url: string;
  last_seen: string; // ISO
};

export type PlayerEntry = {
  key: string;
  name: string;
  links: Record<string, string>; // domain -> url
  lastSeen: string;
};

export async function getPlayerMatrix(days = 180): Promise<{ players: PlayerEntry[]; domains: string[] }> {
  const sql = `
    /* 1) Build a single "name_src" per row using best-available signal */
    WITH base AS (
      SELECT
        REPLACE(a.domain, 'www.', '') AS domain,
        a.url,
        COALESCE(a.published_at, a.discovered_at) AS ts,
        COALESCE(
          /* Bare-name title already present (incl. initials/suffixes) */
          CASE
            WHEN COALESCE(a.cleaned_title, a.title) ~* '^[A-Z][A-Za-z.''-]+( [A-Z][A-Za-z.''-]+){0,3}( (?:Jr|Sr|II|III|IV)\\.?)?$'
            THEN COALESCE(a.cleaned_title, a.title)
          END,
          /* FantasyPros slug → INITCAP */
          CASE
            WHEN a.domain ILIKE '%fantasypros.com%'
             AND a.url ~* '/nfl/(players|stats|news)/[a-z0-9-]+\\.php$'
            THEN INITCAP(
                   REPLACE(
                     REGEXP_REPLACE(a.url, '.*/nfl/(?:players|stats|news)/([a-z0-9-]+)\\.php.*', '\\\\1'),
                     '-', ' '
                   )
                 )
          END,
          /* NBCSports slug before id → INITCAP */
          CASE
            WHEN a.domain ILIKE '%nbcsports.com%'
             AND a.url ~* '/nfl/[a-z0-9-]+/(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?$'
            THEN INITCAP(
                   REPLACE(
                     REGEXP_REPLACE(a.url, '.*/nfl/([a-z0-9-]+)/.*', '\\\\1'),
                     '-', ' '
                   )
                 )
          END,
          /* Fallback to cleaned/title */
          COALESCE(a.cleaned_title, a.title)
        ) AS name_src
      FROM articles a
      WHERE a.is_player_page IS TRUE
        AND COALESCE(a.published_at, a.discovered_at) >= NOW() - ($1 || ' days')::interval
    ),

    /* 2) Compute a normalization key from name_src */
    keyed AS (
      SELECT
        LOWER(REGEXP_REPLACE(name_src, '[^A-Za-z0-9 ]', '', 'g')) AS norm_key,
        name_src AS name_display,
        domain,
        url,
        ts
      FROM base
      WHERE name_src IS NOT NULL AND LENGTH(name_src) > 0
    ),

    /* 3) Keep the latest URL per (player, domain) */
    latest_per_domain AS (
      SELECT DISTINCT ON (norm_key, domain)
        norm_key AS key,
        name_display AS name,
        domain,
        url,
        ts
      FROM keyed
      ORDER BY norm_key, domain, ts DESC NULLS LAST
    )

    /* 4) Final rows */
    SELECT
      key,
      name,
      domain,
      url,
      ts::text AS last_seen
    FROM latest_per_domain
    ORDER BY key, domain;
  `;

  const res = await dbQuery<PlayerMatrixRow>(sql, [String(days)]);

  // Pivot rows into a matrix: players[] with domain -> url map
  const playersMap = new Map<string, PlayerEntry>();
  const domainSet = new Set<string>();

  for (const r of res.rows) {
    domainSet.add(r.domain);
    const cur = playersMap.get(r.key);
    if (!cur) {
      playersMap.set(r.key, {
        key: r.key,
        name: r.name,
        links: { [r.domain]: r.url },
        lastSeen: r.last_seen,
      });
    } else {
      cur.links[r.domain] = r.url;
      if (r.last_seen > cur.lastSeen) cur.lastSeen = r.last_seen;
    }
  }

  const players = [...playersMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const domains = [...domainSet.values()].sort((a, b) => a.localeCompare(b));
  return { players, domains };
}
