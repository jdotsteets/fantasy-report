// lib/contentFilter.ts
// Typed, flexible, per-source filtering for NFL/Fantasy content (no `any`).
import { normalizeTitle } from "@/lib/strings";

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


// ⬇️ add these helpers near your other constants

// NFL teams (names + common short codes)
const TEAM_NAMES = [
  "49ers","Bears","Bengals","Bills","Broncos","Browns","Buccaneers","Cardinals","Chargers","Chiefs","Colts",
  "Commanders","Cowboys","Dolphins","Eagles","Falcons","Giants","Jaguars","Jets","Lions","Packers","Panthers",
  "Patriots","Raiders","Rams","Ravens","Saints","Seahawks","Steelers","Texans","Titans","Vikings",
];
const TEAM_SHORT = [
  "SF","CHI","CIN","BUF","DEN","CLE","TB","ARI","LAC","KC","IND","WAS","DAL","MIA","PHI","ATL","NYG","JAX",
  "NYJ","DET","GB","CAR","NE","LV","LAR","BAL","NO","SEA","PIT","HOU","TEN","MIN",
];

const TRADE_VERBS = /(trade[sd]?|acquire[sd]?|send[s]?|deal[sd]?|land(?:ed)?|swap(?:ped)?)/i;
const FANTASY_HINTS = /(fantasy|dynasty|redraft|keeper|buy(?:\s|-)?low|sell(?:\s|-)?high|rankings?|start\/sit|advice|waiver)/i;
const TRADE_TARGET_PHRASE = /\btrade\b.*\btarget(s)?\b/i;

function countTeamMentions(lowerBlob: string): number {
  const padded = ` ${lowerBlob} `;
  let n = 0;
  for (const name of TEAM_NAMES) {
    if (padded.includes(` ${name.toLowerCase()} `)) n++;
  }
  for (const abbr of TEAM_SHORT) {
    const a = abbr.toLowerCase();
    if (padded.includes(` ${a} `)) n++;
  }
  return n;
}


function testAny(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  for (const re of patterns) if (re.test(text)) return true;
  return false;
}

/** Very lightweight classifier used by allowItem. */
export function classifyLeagueCategory(item: FeedLike): { league: League; category: Category } {
  // Normalize title to remove junk like "NEWSRanking…" and decode HTML entities
  const titleNorm = normalizeTitle(item.title);
  const blobLower = `${titleNorm} ${item.description ?? ""} ${item.link}`.toLowerCase();

  // League
  const league: League =
    /\bnfl\b/i.test(blobLower) || /fantasy[ -]?football/i.test(blobLower)
      ? "NFL"
      : testAny(blobLower, NON_NFL_TERMS)
      ? "OTHER"
      : "UNKNOWN";

  // --- Trade routing: real NFL transactions vs fantasy trade advice ---
  const mentionsTrade = /trade/i.test(blobLower);
  let tradeOverride: Category | null = null;
  if (mentionsTrade) {
    const hasTwoTeams = countTeamMentions(blobLower) >= 2;
    const hasTradeVerb = TRADE_VERBS.test(blobLower);
    const looksLikeAdvice = FANTASY_HINTS.test(blobLower) || TRADE_TARGET_PHRASE.test(blobLower);

    if (hasTwoTeams && hasTradeVerb) {
      tradeOverride = "News";      // e.g., "Raiders trade Jakobi Meyers to Patriots"
    } else if (looksLikeAdvice) {
      tradeOverride = "Fantasy";   // e.g., "Week 3 Trade Targets", "Buy Low/Sell High"
    }
  }

  // Category (general heuristics)
  let category: Category =
    /waiver/i.test(blobLower) ? "DepthChart" :
    /start[\s-]?sit/i.test(blobLower) ? "Fantasy" :
    /\branking|tiers?\b/i.test(blobLower) ? "Fantasy" :
    /\binjur(y|ies)|inactives?|questionable|doubtful|probable/i.test(blobLower) ? "Injury" :
    /\bdfs|draftkings|fanduel|daily[- ]fantasy/i.test(blobLower) ? "Fantasy" :
    testAny(blobLower, SCOREBOARD_HINTS) ? "Scoreboard" :
    /rumou?r/i.test(blobLower) ? "Rumor" :
    /advice|analysis|strategy|cheat[- ]?sheet|values|sleepers/i.test(blobLower) ? "Fantasy" :
    "News";

  // Apply trade override if we determined one
  if (tradeOverride) category = tradeOverride;

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

    // NBCSports — NFL-only and exclude player pages + hubs
    {
      match: { domain: "nbcsports.com" },

      // Must live under /nfl/
      pathAllow: [/^\/nfl(\/|$)/i],

      // Obvious non-NFL sections
      pathDeny: [
        /^\/(watch|soccer|mlb|nba|nhl|college-?football)\//i,
      ],

      // Forbid player detail urls and "bare-name" titles; also block hub/tag listings
      forbidden: [
        // /nfl/<slug>/<id> where <id> is numeric OR NBC GUID
        /\/nfl\/[a-z0-9-]+\/(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i,

        // bare-name titles allowing initials/dots/hyphens and common suffixes
        /^[A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,3}(?: (?:Jr|Sr|II|III|IV|V)\.?)?$/,

        // hub/tag/category pages under /nfl/
        /\/nfl\/(?:tag|category|topics?)\//i,
      ],

      categoryAllow: ["Fantasy", "News", "Injury", "Rumor"],
    },

    // FantasyPros by source_id (3126) — block "»" titles and player/stat/news php pages
    {
      match: { sourceId: "3126" },
      pathAllow: [/^\/nfl\//i],
      forbidden: [/^»/, /\/nfl\/(players|stats|news)\/[a-z0-9-]+\.php$/i],
      requiredAny: [/\bnfl\b/i, /fantasy[ -]?football/i],
      categoryAllow: ["Fantasy", "News", "Injury"]
    },

    // Fantasy Footballers
    {
      match: { domain: "fantasyfootballers.com" },
      // deny tools/hubs
      pathDeny: [/\/(lineup|optimizer|builder|dfs-?pass|tools?)(\/|$)/i],
      forbidden: [
        /\b(DFS Pass|Lineup Generator|Multi Lineup Optimizer|Single Lineup Builder|DFS Articles)\b/i,
        /<[^>]+>/ // HTML leaked into title
      ],
      requiredAny: [/\bnfl\b/i, /fantasy[ -]?football/i],
      categoryAllow: ["Fantasy", "News"]
    },

    // Footballguys
    {
      match: { domain: "footballguys.com" },
      pathDeny: [/\/(lineup|optimizer|builder|dfs-?pass|tools?)(\/|$)/i],
      forbidden: [
        /\b(DFS Pass|Lineup Generator|Multi Lineup Optimizer|Single Lineup Builder|News \(free only\))\b/i
      ],
      requiredAny: [/\bnfl\b/i, /fantasy[ -]?football/i],
      categoryAllow: ["Fantasy", "News"]
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


