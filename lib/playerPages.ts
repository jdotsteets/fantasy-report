// lib/playerPages.ts
import { dbQuery } from "@/lib/db";

export type PlayerMatrixRow = {
  key: string;
  name: string;
  domain: string | null;
  url: string | null;
  last_seen: string;
};

export type PlayerEntry = {
  key: string;
  name: string;
  links: Record<string, string>;
  lastSeen: string;
};

// add near top of file
const STOPWORDS = new Set([
  'fantasy','football','dfs','picks','rankings','tiers','ros','depth','chart','schedule','leaders',
  'targets','cheat','sheets','mock','draft','injury','news','preview','recap','guide','see','full',
  'standard','half','ppr','dynasty','handcuffs','consensus','pros','articles','season','questions'
]);

const TEAM_TOKENS = new Set([
  'cardinals','falcons','ravens','bills','panthers','bears','bengals','browns','cowboys','broncos',
  'lions','packers','texans','colts','jaguars','chiefs','raiders','chargers','rams','dolphins',
  'vikings','patriots','saints','giants','jets','eagles','steelers','49ers','seahawks','buccaneers',
  'titans','commanders','niners'
]);

// “Firstname Lastname” (+ optional 1–2 extra parts and suffix)
const LIKELY_PERSON_RE =
  /^[A-Z][a-zA-Z.'-]+(?: [A-Z][a-zA-Z.'-]+){1,3}(?: (?:Jr|Sr|II|III|IV)\.?)?$/;

// stronger validator
function isLikelyNFLPlayerName(name: string): boolean {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!LIKELY_PERSON_RE.test(clean)) return false;

  const tokens = clean.toLowerCase().split(' ');
  // drop if any stopword/team token present
  if (tokens.some(t => STOPWORDS.has(t) || TEAM_TOKENS.has(t))) return false;

  // drop coaches-only patterns quickly (Daboll, Tomlin, McDaniel alone)
  if (tokens.length === 1) return false;

  // light other-sport guard: common non-NFL names seen in feeds
  if (/alcaraz|djokovic|mlb|nba|nhl|nca[abf]/i.test(clean)) return false;

  return true;
}


// very light heuristic for person-like names
function looksLikePersonish(name: string): boolean {
  const raw = name.trim();
  if (raw.length < 5 || raw.length > 60) return false;

  // split and basic shape: 2–4 words, each starting uppercase
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;

  // reject obvious non-person tokens
  const bad = new Set([
    "See","Full","DraftKings","Fantasy","Football","Depth","Chart","Team","Schedule","Injuries",
    "DFS","Targets","Leaders","Cheat","Sheets","Analyzer","Mock","Drafts","Rankings","PPR",
    "Half","Standard","View","News","Guide","Guide,"
  ]);
  if (parts.some(p => bad.has(p))) return false;

  // must start with capital letters, and most tokens should be alphabetic
  let alphaCount = 0;
  for (const p of parts) {
    if (!/^[A-Z][a-z'.-]+$/.test(p)) return false;
    if (/^[A-Za-z'.-]+$/.test(p)) alphaCount++;
  }
  if (alphaCount < parts.length - 0) return false;

  // exclude team/location phrases
  const teamWords = new Set([
    "Los","Angeles","San","Francisco","New","York","Green","Bay","Kansas","City",
    "Dallas","Chicago","Seattle","Miami","Washington","Cleveland","Detroit","Arizona",
    "Ravens","Bears","Cowboys","Seahawks","Dolphins","Vikings","Chiefs","Packers",
    "Steelers","Broncos","Buccaneers","Falcons","Chargers","Rams","Commanders","Bengals",
  ]);
  const teamish = parts.filter(p => teamWords.has(p)).length >= 2;
  if (teamish) return false;

  return true;
}



function normalizeDomain(d: string | null, url: string | null): string {
  try {
    const fromD = (d ?? "").trim();
    if (fromD) return fromD.toLowerCase().replace(/^www\./, "");
    if (url) return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {}
  return "";
}

export async function getPlayerMatrix(
  days = 180
): Promise<{ players: PlayerEntry[]; domains: string[] }> {
  const sql = `
    /* 0) Heuristic: compute is_pp even if DB hasn't flagged it yet */
    WITH src AS (
      SELECT
        a.domain,
        a.url,
        COALESCE(a.cleaned_title, a.title) AS title,
        COALESCE(a.published_at, a.discovered_at) AS ts,
        (
          a.is_player_page IS TRUE
          OR (
            a.url ~* '(fantasypros\\.com/.*/nfl/(players|stats|news)/[a-z0-9-]+\\.php)'
            OR a.url ~* '(nbcsports\\.com/.*/nfl/[a-z0-9-]+/(\\d+|[0-9a-f-]{36}))'
            OR a.url ~* '(sports\\.yahoo\\.com/.*/nfl/players/\\d+)'
            OR a.url ~* '(espn\\.com/nfl/player/_/id/\\d+)'
            OR a.url ~* '(pro-football-reference\\.com/players/[A-Z]/[A-Za-z0-9]+\\.htm)'
            OR a.url ~* '(rotowire\\.com/football/player/[a-z0-9-]+-\\d+)'
          )
          OR (
            /* very bare "Firstname Lastname" titles look like profile pages */
            COALESCE(a.cleaned_title, a.title) ~ '^[A-Z][A-Za-z.''-]+( [A-Z][A-Za-z.''-]+){0,3}( (?:Jr|Sr|II|III|IV)\\.?)?$'
          )
        ) AS is_pp
      FROM articles a
      WHERE COALESCE(a.published_at, a.discovered_at) >= NOW() - ($1 || ' days')::interval
    ),

    /* 1) choose best-available display name */
    base AS (
      SELECT
        REPLACE(domain, 'www.', '') AS domain,
        url,
        ts,
        COALESCE(
          /* Bare-name title already present (incl. initials/suffixes) */
          CASE
            WHEN title ~* '^[A-Z][A-Za-z.''-]+( [A-Z][A-Za-z.''-]+){1,3}( (?:Jr|Sr|II|III|IV)\\.?)?$'
            THEN title
          END,
          /* FantasyPros slug → INITCAP */
          CASE
            WHEN domain ILIKE '%fantasypros.com%'
             AND url ~* '/nfl/(players|stats|news)/[a-z0-9-]+\\.php$'
            THEN INITCAP(
                   REPLACE(
                     REGEXP_REPLACE(url, '.*/nfl/(?:players|stats|news)/([a-z0-9-]+)\\.php.*', '\\\\1'),
                     '-', ' '
                   )
                 )
          END,
          /* NBCSports Rotoworld style slug → INITCAP */
          CASE
            WHEN domain ILIKE '%nbcsports.com%'
             AND url ~* '/nfl/[a-z0-9-]+/(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?$'
            THEN INITCAP(
                   REPLACE(
                     REGEXP_REPLACE(url, '.*/nfl/([a-z0-9-]+)/.*', '\\\\1'),
                     '-', ' '
                   )
                 )
          END
        ) AS name_src
      FROM src
      WHERE is_pp = TRUE
    ),

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

    SELECT
      key, name, domain, url, ts::text AS last_seen
    FROM latest_per_domain
    ORDER BY key, domain;
  `;

  const res = await dbQuery<PlayerMatrixRow>(sql, [String(days)]);

  const playersMap = new Map<string, PlayerEntry>();
  const domainSet = new Set<string>();

  for (const r of res.rows) {
    const domain = normalizeDomain(r.domain, r.url);
    const url = r.url ?? "";
    if (!domain || !url) continue;

    if (!isLikelyNFLPlayerName(r.name)) continue;
    if (!looksLikePersonish(r.name)) continue;

    domainSet.add(domain);

    const cur = playersMap.get(r.key);
    if (!cur) {
      playersMap.set(r.key, { key: r.key, name: r.name, links: { [domain]: url }, lastSeen: r.last_seen });
    } else {
      if (!cur.links[domain]) cur.links[domain] = url;
      if (r.last_seen > cur.lastSeen) cur.lastSeen = r.last_seen;
    }
  }

  const players = Array.from(playersMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  const domains = Array.from(domainSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  return { players, domains };
}
