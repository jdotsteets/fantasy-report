// lib/contentFilter.ts

/**
 * Content filtering + categorization helpers.
 * - allowItem(item, url) => boolean
 * - classifyLeagueCategory(...) => "fantasy" | "news" | "injury" | "team" | "analysis" | "other"
 *
 * Backward compatible:
 *   classifyLeagueCategory(feedLike)  // old usage
 *   classifyLeagueCategory(title, url, domain?) // new usage
 */

type FeedLike = {
  title?: string | null;
  description?: string | null;
  categories?: (string | null)[] | null;
};

const NFL_WORD = /\bnfl\b/i;
const FANTASY_FOOTBALL = /fantasy[-\s]?football/i;

// Obvious non-NFL league path markers we want to block.
const NON_NFL_PATH_DENY = [
  /(^|\/)(mlb|nba|nhl|college|ncaa|mls|soccer)\b/i,
];

// Player page patterns to exclude from main feed.
const PLAYER_PAGE_DENY = [
  /\/player-news\b/i,
  /\/players?\/?/i,
  /\/player\/?/i,
  /\/stats\/players?\b/i,
];

// Team sites
const TEAM_HOST_PATTERNS: RegExp[] = [
  /(^|\.)philadelphiaeagles\.com$/i,
  /(^|\.)giants\.com$/i,
  /(^|\.)newyorkjets\.com$/i,
  /(^|\.)commanders\.com$/i,
  /(^|\.)packers\.com$/i,
  /(^|\.)detroitlions\.com$/i,
  /(^|\.)chicagobears\.com$/i,
  /(^|\.)vikings\.com$/i,
  /(^|\.)atlantafalcons\.com$/i,
  /(^|\.)panthers\.com$/i,
  /(^|\.)buccaneers\.com$/i,
  /(^|\.)saints\.com$/i,
  /(^|\.)neworleanssaints\.com$/i,
  /(^|\.)49ers\.com$/i,
  /(^|\.)seahawks\.com$/i,
  /(^|\.)rams\.com$/i,
  /(^|\.)therams\.com$/i,
  /(^|\.)azcardinals\.com$/i,
  /(^|\.)patriots\.com$/i,
  /(^|\.)buffalobills\.com$/i,
  /(^|\.)miamidolphins\.com$/i,
  /(^|\.)steelers\.com$/i,
  /(^|\.)bengals\.com$/i,
  /(^|\.)browns\.com$/i,
  /(^|\.)baltimoreravens\.com$/i,
  /(^|\.)ravens\.com$/i,
  /(^|\.)colts\.com$/i,
  /(^|\.)jaguars\.com$/i,
  /(^|\.)titans\.com$/i,
  /(^|\.)tennesseetitans\.com$/i,
  /(^|\.)houstontexans\.com$/i,
  /(^|\.)chiefs\.com$/i,
  /(^|\.)raiders\.com$/i,
  /(^|\.)chargers\.com$/i,
  /(^|\.)denverbroncos\.com$/i,
  /(^|\.)dallascowboys\.com$/i,
];

function getHost(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase(); } catch { return null; }
}
function getPath(u: string): string {
  try { return new URL(u).pathname.toLowerCase(); } catch { return u.toLowerCase(); }
}

/** True = keep; False = filtered out. */
export function allowItem(item: FeedLike, url: string): boolean {
  const host = getHost(url) || "";
  const path = getPath(url);

  // Block team sites outright
  if (TEAM_HOST_PATTERNS.some((rx) => rx.test(host))) return false;

  // Block other leagues
  if (NON_NFL_PATH_DENY.some((rx) => rx.test(path))) return false;

  // Block player pages
  if (PLAYER_PAGE_DENY.some((rx) => rx.test(path))) return false;

  // Global allow: URL contains "nfl" or "fantasy-football"
  if (NFL_WORD.test(path) || FANTASY_FOOTBALL.test(path)) return true;

  // FantasyPros: /nfl/ in path counts
  if (host.endsWith("fantasypros.com") && path.includes("/nfl/")) return true;

  // Fallback: text mentions
  const t = `${item.title ?? ""} ${item.description ?? ""}`;
  if (NFL_WORD.test(t) || FANTASY_FOOTBALL.test(t)) return true;

  // Be permissive by default (tighten if desired)
  return true;
}

/**
 * Category classifier (lowercase result).
 * Back-compat overload:
 *   classifyLeagueCategory(feedLike) // tries feedLike.link/url for URL
 * Preferred:
 *   classifyLeagueCategory(title, url, domain?)
 */
export function classifyLeagueCategory(
  arg1: FeedLike | string | null | undefined,
  urlMaybe?: string,
  domainMaybe?: string | null
): "fantasy" | "news" | "injury" | "team" | "analysis" | "other" {
  let title: string | null | undefined;
  let url: string;
  let domain = domainMaybe ?? null;

  if (typeof arg1 === "object" && arg1 !== null) {
    // Old usage: first param is the feed-like object
    const obj = arg1 as any;
    title = obj.title ?? null;
    url = (obj.link || obj.url || "").toString();
    if (!domain) domain = getHost(url);
  } else {
    // New usage: (title, url, domain?)
    title = arg1 as string | null | undefined;
    url = (urlMaybe || "").toString();
    if (!domain) domain = getHost(url);
  }

  const host = (domain || getHost(url) || "").toLowerCase();
  const path = getPath(url);
  const text = `${title ?? ""} ${url}`.toLowerCase();

  // Team sites
  if (TEAM_HOST_PATTERNS.some((rx) => rx.test(host))) return "team";

  // Injury
  if (text.includes("injury") || /\/injur(y|ies)\b/.test(path)) return "injury";

  // Fantasy signals
  const fantasySignals = [
    /rankings?/i,
    /start-?sit/i,
    /waiver/i,
    /dfs\b/i,
    /projections?/i,
    /sleepers?/i,
    /stashes?/i,
    FANTASY_FOOTBALL,
  ];
  if (fantasySignals.some((rx) => rx.test(text))) return "fantasy";

  // News
  if (/\/news\//i.test(path) || /\bnews\b/i.test(text)) return "news";

  return "analysis";
}
