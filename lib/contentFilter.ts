// lib/contentFilter.ts
// Typed, flexible, per-source filtering for NFL/Fantasy content (no `any`).

export type League = "NFL" | "NBA" | "MLB" | "NHL" | "NCAA" | "OTHER" | "UNKNOWN";
export type Category =
  | "Fantasy"
  | "News"
  | "Injury"
  | "Rumor"
  | "DepthChart"
  | "Scoreboard"
  | "OTHER"
  | "UNKNOWN";

export type FeedLike = {
  title: string;
  description: string | null;
  link: string;
};

export type SourceRule = {
  /** Identify source by domain or a specific DB source_id string */
  match: { domain?: string; sourceId?: string };
  /** Require at least one of these keywords anywhere in title/desc/url. */
  requiredAny?: ReadonlyArray<RegExp>;
  /** Hard-block if any match. */
  forbidden?: ReadonlyArray<RegExp>;
  /** Allow/deny by URL path only (after domain). */
  pathAllow?: ReadonlyArray<RegExp>;
  pathDeny?: ReadonlyArray<RegExp>;
  /** Only allow when classifier detects one of these. */
  leagueAllow?: ReadonlyArray<League>;
  categoryAllow?: ReadonlyArray<Category>;
};

export type FilterConfig = {
  /** Defaults applied to every source (merged with source-specific rules). */
  defaults?: Omit<SourceRule, "match">;
  /** Per-source overrides. */
  sources: ReadonlyArray<SourceRule>;
};

const NON_NFL_TERMS: ReadonlyArray<RegExp> = [
  /\bMLB\b/i, /\bNBA\b/i, /\bNHL\b/i, /\bWNBA\b/i, /\bMLS\b/i,
  /\bPremier League\b/i, /\bLa Liga\b/i, /\bUFC\b/i, /\bNASCAR\b/i,
  /\bbaseball\b/i, /\bbasketball\b/i, /\bhockey\b/i, /\bsoccer\b/i,
  /\bcricket\b/i, /\brugby\b/i, /\btennis\b/i, /\bgolf\b/i
];

const SCOREBOARD_HINTS: ReadonlyArray<RegExp> = [
  /scoreboard/i, /scores?/i, /schedule/i, /fixtures?/i, /results?/i
];

function testAny(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  for (const re of patterns) if (re.test(text)) return true;
  return false;
}

/** Very lightweight classifier used by allowItem. */
export function classifyLeagueCategory(item: FeedLike): { league: League; category: Category } {
  const blob = `${item.title} ${item.description ?? ""} ${item.link}`.toLowerCase();

  // League: NFL if "nfl" or "fantasy football" is present; otherwise UNKNOWN/OTHER
  const league: League =
    /\bnfl\b/i.test(blob) || /fantasy[ -]?football/i.test(blob) ? "NFL" :
    testAny(blob, NON_NFL_TERMS) ? "OTHER" : "UNKNOWN";

  // Category: quick heuristics
  const category: Category =
    /waiver/i.test(blob) ? "DepthChart" :
    /start[\s-]?sit/i.test(blob) ? "Fantasy" :
    /\branking|tiers?\b/i.test(blob) ? "Fantasy" :
    /\binjur(y|ies)|inactives?|questionable|doubtful|probable/i.test(blob) ? "Injury" :
    /\bdfs|draftkings|fanduel|daily[- ]fantasy/i.test(blob) ? "Fantasy" :
    testAny(blob, SCOREBOARD_HINTS) ? "Scoreboard" :
    /rumou?r/i.test(blob) ? "Rumor" :
    /advice|analysis|strategy|cheat[- ]?sheet|values|sleepers/i.test(blob) ? "Fantasy" :
    "News";

  return { league, category };
}

/** Utility: normalized host check (drop www.) */
function hostIs(u: URL, domain: string): boolean {
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  return host === domain.toLowerCase();
}

/** Adjustable, typed rule set. Extend as you add sources. */
export const filterConfig: FilterConfig = {
  defaults: {
    forbidden: [
      /\/(about|privacy|terms|contact|subscribe|gift|advertis|affiliate|login|signin|signup|careers)\b/i
    ],
    pathDeny: [/\/scoreboard\b/i, /\/scores?\b/i, /\/schedule\b/i],
    leagueAllow: ["NFL"], // global “NFL-only”
    // leave categoryAllow undefined by default
  },
  sources: [
    // FantasyPros – only NFL areas
    {
      match: { domain: "fantasypros.com" },
      pathAllow: [/^\/nfl\//i],
      pathDeny:  [/^\/(mlb|nba|nhl|college)\//i],
      requiredAny: [/\bnfl\b/i, /\bfantasy\b/i],
      categoryAllow: ["Fantasy", "News", "Injury"],
    },
    // ESPN – block hubs/scores; allow NFL article paths
    {
      match: { domain: "espn.com" },
      pathDeny: [/\/scoreboard\b/i, /\/schedule\b/i, /\/watch\b/i, /\/(?:login|account)\b/i],
      pathAllow: [/^\/nfl\//i, /^\/(story|blog|article)\b/i],
      requiredAny: [/\bnfl\b/i],
      categoryAllow: ["Fantasy", "News", "Injury", "Rumor", "DepthChart"],
    },

    // NBCSports — NFL-only and exclude player pages
    {
      match: { domain: "nbcsports.com" },
      // Require content to live under /nfl/
      pathAllow: [/^\/nfl\//i],
      // Deny obvious non-NFL sections and generic watch pages
      pathDeny:  [/^\/watch\//i, /\/soccer\//i, /\/(mlb|nba|nhl)\//i],
      // Forbid player detail urls and "bare-name" titles (e.g., "C.J. Henderson")
      forbidden: [
        /\/nfl\/[a-z0-9-]+\/\d+\/?$/i,
        /^[A-Z][A-Za-z\.'\-]+( [A-Z][A-Za-z\.'\-]+){0,3}$/
      ],
      categoryAllow: ["Fantasy", "News", "Injury", "Rumor"]
    },

    // FantasyPros by source_id (3126) — block "»" titles and player/stat/news php pages
    {
      match: { sourceId: "3126" },
      pathAllow: [/^\/nfl\//i],
      forbidden: [/^»/, /\/nfl\/(players|stats|news)\/[a-z0-9-]+\.php$/i],
      requiredAny: [/\bnfl\b/i, /fantasy[ -]?football/i],
      categoryAllow: ["Fantasy", "News", "Injury"]
    },

    // Restrict selected sources to NFL/fantasy-football only by source_id
    { match: { sourceId: "3135" }, requiredAny: [/\bnfl\b/i, /fantasy[ -]?football/i] },
    { match: { sourceId: "3138" }, requiredAny: [/\bnfl\b/i, /fantasy[ -]?football/i] },
    { match: { sourceId: "3141" }, requiredAny: [/\bnfl\b/i, /fantasy[ -]?football/i] },
  ],
};

/** Merge defaults and per-source rules for the given URL/id. */
function resolveRules(u: URL, sourceIdOrUrl: string): Required<Omit<SourceRule, "match">> {
  
  const byDomain = filterConfig.sources.find(
    (s) => s.match.domain && hostIs(u, s.match.domain)
  );
  const byId = filterConfig.sources.find(
    (s) => s.match.sourceId && sourceIdOrUrl === s.match.sourceId
  );
  const picked = byId ?? byDomain;

  return {
    forbidden: [...(filterConfig.defaults?.forbidden ?? []), ...(picked?.forbidden ?? [])],
    pathAllow: [...(filterConfig.defaults?.pathAllow ?? []), ...(picked?.pathAllow ?? [])],
    pathDeny:  [...(filterConfig.defaults?.pathDeny  ?? []), ...(picked?.pathDeny  ?? [])],
    requiredAny: picked?.requiredAny ?? filterConfig.defaults?.requiredAny ?? [],
    leagueAllow: picked?.leagueAllow ?? filterConfig.defaults?.leagueAllow ?? [],
    categoryAllow: picked?.categoryAllow ?? filterConfig.defaults?.categoryAllow ?? [],
  };
}

/** Final decision used by ingestion and anywhere else. */
export function allowItem(item: FeedLike, sourceIdOrUrl: string): boolean {
  const u = new URL(item.link);
  const rules = resolveRules(u, sourceIdOrUrl);

  const blob = `${item.title}\n${item.description ?? ""}\n${item.link}`.toLowerCase();

  if (rules.forbidden.some((re) => re.test(blob) || re.test(u.pathname))) return false;
  if (rules.pathDeny.some((re) => re.test(u.pathname))) return false;
  if (rules.pathAllow.length > 0 && !rules.pathAllow.some((re) => re.test(u.pathname))) return false;

  if (rules.requiredAny.length > 0 && !rules.requiredAny.some((re) => re.test(blob))) return false;

  const { league, category } = classifyLeagueCategory(item);
  if (rules.leagueAllow.length > 0 && !rules.leagueAllow.includes(league)) return false;
  if (rules.categoryAllow.length > 0 && !rules.categoryAllow.includes(category)) return false;

  return true;
}
