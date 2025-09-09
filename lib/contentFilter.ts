// lib/contentFilter.ts
// Content filtering & lightweight classification for NFL fantasy ingestion
// - Strong hard-blocks for junk (sitemaps, feeds, tags/categories, etc.)
// - Other-sports deny
// - Player-page deny
// - Keeps NFL/fantasy URLs as a *boost* only (after hard-blocks)
// - Optional richer classifier (classifyUrl) for articles vs static rankings vs section hubs
// No `any` types.

export type FeedLike = {
  title?: string | null;
  description?: string | null;
  categories?: (string | null)[] | null;
  // Some RSS libs use `link`, others `url`; we won't rely on them here,
  // but classifyLeagueCategory supports both in old-usage mode.
  link?: string | null;
  url?: string | null;
};

export type PageSignals = {
  hasPublishedMeta: boolean;   // e.g., meta article:published_time or datePublished
  hasArticleSchema: boolean;   // schema.org Article/NewsArticle detected
};

export type UrlClassification =
  | { decision: "discard"; reason: string }
  | {
      decision: "include_article" | "include_static" | "capture_section" | "include_player_page";
      league: "nfl" | "other";
      category:
        | "rankings"
        | "start-sit"
        | "waiver"
        | "injury"
        | "dfs"
        | "advice"
        | "news"
        | "analysis"
        | "other"
        | "fantasy"
        | "team";   // ← add these two
      staticType?: "rankings" | "tools" | "depth-chart" | "other";
      sectionType?:
        | "rankings-index"
        | "tools"
        | "podcasts"
        | "videos"
        | "teams"
        | "injuries"
        | "depth-charts"
        | "other";
      reason: string;
      signals: {
        hasDateInUrl: boolean;
        hasPublishedMeta: boolean;
        hasArticleSchema: boolean;
        hasFantasyKeyword: boolean;
        hasNFLKeyword: boolean;
        pathDepth: number;
        looksStaticRanking: boolean;
        looksSectionHub: boolean;
      };
    };



    // Player page patterns (more precise than before)
const PLAYER_PAGE_CANDIDATE: RegExp[] = [
  /\/nfl\/players?\//i,                 // fantasypros, rotoworld, rotowire, etc.
  /\/player\/[a-z0-9-]+/i,              // generic /player/<slug>
  /\/nfl\/[a-z0-9-]+\/[0-9a-f-]{8,}\/?$/i, // nbcsports style .../<slug>/<uuid>
  /\/stats\/players?\b/i,               // player stat pages
  /\/player-news\b/i                    // player news hubs (still keep; we’ll classify later)
];

export function looksLikePlayerPageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    return PLAYER_PAGE_CANDIDATE.some((rx) => rx.test(path));
  } catch {
    return false;
  }
}


// ───────────────────────────── Regex & helpers ─────────────────────────────

const NFL_WORD = /\bnfl\b/i;
const FANTASY_FOOTBALL = /\bfantasy[- ]football\b/i;

// Obvious non-NFL league markers (path or title)
const NON_NFL_PATH_DENY: RegExp[] = [
  /(^|\/)(mlb|nba|nhl|ncaaf|ncaab|college|ncaa|mls|soccer|fifa|epl|ufc|mma|golf|nascar)\b/i,
];

// Player page patterns to exclude from main feed
const PLAYER_PAGE_DENY: RegExp[] = [
  /\/player-news\b/i,
  /\/players?\b/i,
  /\/player\b/i,
  /\/stats\/players?\b/i,
];

// Generic junk / non-article paths (feeds, sitemaps, tags, categories, pagers, etc.)
const JUNK_PATH_DENY: RegExp[] = [
  /\/sitemap[^\s]*\.(xml|gz)$/i,
  /\/(?:feed|rss)(?:\.xml)?$/i,
  /\/tag(?:s)?\//i,
  /\/categor(?:y|ies)\//i,
  /\/topics?\//i,
  /\/labels?\//i,
  /\/authors?\//i,
  /\/contributors?\//i,
  /\/page\/\d+\/?/i,
  /\/amp\/?$/i,
  /\/print\/?$/i,
  /\/(shop|store|merch)\//i,
  /\.xml(?:$|\?)/i,
];

// Non-HTML asset extensions we never want to ingest as “articles”
const NON_HTML_EXT = /\.(pdf|csv|json|zip|webp|gif|mp4|mp3|m4a|mov|avi|wav)(?:$|\?)/i;

// Date pattern in URL
const DATE_IN_URL = /\/20\d{2}[\/-]\d{1,2}(?:[\/-]\d{1,2})?\//;

// Static rankings detection (title or path)
const STATIC_RANKING = /\b(rankings?|tiers?|ros|rest[- ]of[- ]season|ecr|expert consensus|week[- ]\d+|top[- ]\d+|qb|rb|wr|te|flex|dst|k|idp|ppr|half[- ]ppr|standard|dynasty|best[- ]ball|superflex)\b/i;

// Section hub detection (short paths ending with these sections)
const SECTION_HUBS = /\/(?:rankings|tools|podcasts?|videos?|teams|injur(?:y|ies)|depth[- ]?charts?)\/?$/i;

// Team sites (example keeps; extend as needed)
const TEAM_HOST_PATTERNS: RegExp[] = [
  /(^|\.)philadelphiaeagles\.com$/i,
  /(^|\.)dallascowboys\.com$/i,
  /(^|\.)patriots\.com$/i,
  // add more official team domains if you want to block them completely
];

function getHost(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getPath(u: string): string {
  try {
    return new URL(u).pathname.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

function pathDepth(u: URL): number {
  return u.pathname.split("/").filter(Boolean).length;
}

function inferSectionType(pathname: string):
  | "rankings-index"
  | "tools"
  | "podcasts"
  | "videos"
  | "teams"
  | "injuries"
  | "depth-charts"
  | "other" {
  if (/rankings/i.test(pathname)) return "rankings-index";
  if (/tools/i.test(pathname)) return "tools";
  if (/podcasts?/i.test(pathname)) return "podcasts";
  if (/videos?/i.test(pathname)) return "videos";
  if (/teams/i.test(pathname)) return "teams";
  if (/injur/i.test(pathname)) return "injuries";
  if (/depth[- ]?charts?/i.test(pathname)) return "depth-charts";
  return "other";
}

function looksStaticRankingFrom(text: string): boolean {
  return STATIC_RANKING.test(text);
}

function looksSectionHubPath(pathname: string): boolean {
  return SECTION_HUBS.test(pathname);
}

// ───────────────────────────── Primary allow-list ─────────────────────────────

/**
 * Legacy/simple decision used by ingest to quickly filter URLs.
 * True = keep; False = filtered out.
 * NOTE: Keeps NFL/fantasy URLs as a BOOST after hard-blocks.
 */
export function allowItem(item: FeedLike, url: string): boolean {
  const host = getHost(url) || "";
  const path = getPath(url);

  // Block official team sites outright (usually not relevant fantasy articles)
  if (TEAM_HOST_PATTERNS.some((rx) => rx.test(host))) return false;

  // Block other sports
  if (NON_NFL_PATH_DENY.some((rx) => rx.test(path))) return false;
 
  // Block obvious junk (sitemaps, feeds, tags/categories, pagers, etc.)
  if (JUNK_PATH_DENY.some((rx) => rx.test(url))) return false;

  // Block non-HTML asset URLs by extension
  if (NON_HTML_EXT.test(path)) return false;

  if (looksLikePlayerPageUrl(url)) return true;

  // Positive boosts (post-blocks)
  if (NFL_WORD.test(path) || FANTASY_FOOTBALL.test(path)) return true;

  // Domain-specific boost: FantasyPros /nfl/ path
  if (host.endsWith("fantasypros.com") && path.includes("/nfl/")) return true;

  // Fallback: use title/description text for NFL/fantasy hints
  const t = `${item.title ?? ""} ${item.description ?? ""}`;
  if (NFL_WORD.test(t) || FANTASY_FOOTBALL.test(t)) return true;

  // By default, do not ingest
  return false;
}

// ───────────────────────────── Category classifier ─────────────────────────────

/**
 * Classifies league-ish category from title/url/domain.
 * Preserves your existing signature. No `any`.
 *
 * Old usage: classifyLeagueCategory(feedLikeObj)
 * New usage: classifyLeagueCategory(title, url, domain?)
 */
export function classifyLeagueCategory(
  arg1: FeedLike | string | null | undefined,
  urlMaybe?: string,
  domainMaybe?: string | null
):
  | "fantasy"
  | "news"
  | "injury"
  | "team"
  | "analysis"
  | "other" {
  let title: string | null | undefined;
  let url: string;
  let domain: string | null = domainMaybe ?? null;

  if (typeof arg1 === "object" && arg1 !== null) {
    // Old usage: first param is the feed-like object
    const obj: FeedLike = arg1;
    title = obj.title ?? null;
    // Some feed libs use `link`, others use `url`; pick the first present
    const maybeLink: string | undefined =
      (typeof obj.link === "string" ? obj.link : undefined) ??
      (typeof obj.url === "string" ? obj.url : undefined);
    url = String(maybeLink ?? "");
    if (!domain) domain = getHost(url);
  } else {
    // New usage: (title, url, domain?)
    title = (typeof arg1 === "string" || arg1 == null) ? arg1 : null;
    url = String(urlMaybe ?? "");
    if (!domain) domain = getHost(url);
  }

  const hay = `${title ?? ""} ${url} ${domain ?? ""}`.toLowerCase();

  // Simple heuristics (extend as you like)
  if (/\binjur(y|ies|report)\b/.test(hay)) return "injury";
  if (/\bnews|breaking|report|rumors?\b/.test(hay)) return "news";
  if (/\b(start[- ]?sit|who to start|sit em|start em)\b/.test(hay)) return "fantasy";
  if (/\bwaiver|adds?|drops?|wire\b/.test(hay)) return "fantasy";
  if (/\bdfs|draftkings|fanduel|lineups?\b/.test(hay)) return "fantasy";
  if (/\branking(s)?|tiers?|ros|rest[- ]of[- ]season|ecr\b/.test(hay)) return "fantasy";
  if (/\banalysis|breakdown|film|deep[- ]?dive|preview|review\b/.test(hay)) return "analysis";
  if (/\bdepth[- ]?chart|team|roster|schedule\b/.test(hay)) return "team";

  return "other";
}

// ───────────────────────────── Richer URL classifier (optional) ─────────────────────────────

/**
 * classifyUrl: richer decision tree for routing URLs into:
 *   - include_article: real articles (dated or article schema)
 *   - include_static: evergreen/weekly ranking index pages
 *   - capture_section: useful hubs (rankings index, tools, teams, podcasts)
 *   - discard: everything else (junk/other sports/assets/etc.)
 */
export function classifyUrl(
  rawUrl: string,
  title: string | null | undefined,
  signals: PageSignals = { hasPublishedMeta: false, hasArticleSchema: false }
): UrlClassification {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { decision: "discard", reason: "invalid_url" };
  }

  const text = `${u.pathname} ${u.hostname} ${title ?? ""}`;
  const depth = pathDepth(u);

  // Hard blocks
  if (NON_HTML_EXT.test(u.pathname)) return { decision: "discard", reason: "blocked_extension" };
  if (JUNK_PATH_DENY.some((rx) => rx.test(rawUrl))) return { decision: "discard", reason: "blocked_path" };
  if (NON_NFL_PATH_DENY.some((rx) => rx.test(text))) return { decision: "discard", reason: "other_sport" };

  const looksStaticRanking = looksStaticRankingFrom(text);
  const looksHub = looksSectionHubPath(u.pathname) && !signals.hasArticleSchema && !signals.hasPublishedMeta;
  const hasDateInUrl = DATE_IN_URL.test(u.pathname);
  const hasNFLKeyword = NFL_WORD.test(text);
  const hasFantasyKeyword = FANTASY_FOOTBALL.test(text);
  const league: "nfl" | "other" = hasNFLKeyword || hasFantasyKeyword ? "nfl" : "other";

  // Section hubs → capture for UI, not articles feed
  if (looksHub) {
    return {
      decision: "capture_section",
      league,
      category: "other",
      sectionType: inferSectionType(u.pathname),
      reason: "section_hub",
      signals: {
        hasDateInUrl: hasDateInUrl,
        hasPublishedMeta: signals.hasPublishedMeta,
        hasArticleSchema: signals.hasArticleSchema,
        hasFantasyKeyword,
        hasNFLKeyword,
        pathDepth: depth,
        looksStaticRanking,
        looksSectionHub: true,
      },
    };
  }

  // Static rankings (evergreen/index) → keep, but mark static
  if (looksStaticRanking && league === "nfl") {
    return {
      decision: "include_static",
      league: "nfl",
      category: "rankings",
      staticType: "rankings",
      reason: "static_rankings_match",
      signals: {
        hasDateInUrl: hasDateInUrl,
        hasPublishedMeta: signals.hasPublishedMeta,
        hasArticleSchema: signals.hasArticleSchema,
        hasFantasyKeyword,
        hasNFLKeyword,
        pathDepth: depth,
        looksStaticRanking,
        looksSectionHub: false,
      },
    };
  }

  // Articles: published meta OR date in URL OR schema.org Article OR deeper paths
  const isArticleish =
    signals.hasPublishedMeta || hasDateInUrl || signals.hasArticleSchema || depth >= 3;

  if (isArticleish && league === "nfl") {
    const category = classifyLeagueCategory(title ?? "", u.href, u.hostname);
    return {
      decision: "include_article",
      league: "nfl",
      category,
      reason: "article_signals",
      signals: {
        hasDateInUrl: hasDateInUrl,
        hasPublishedMeta: signals.hasPublishedMeta,
        hasArticleSchema: signals.hasArticleSchema,
        hasFantasyKeyword,
        hasNFLKeyword,
        pathDepth: depth,
        looksStaticRanking,
        looksSectionHub: false,
      },
    };
  }

  // Shallow but NFL-ish → capture as a section landing
  if (league === "nfl" && depth <= 2) {
    return {
      decision: "capture_section",
      league: "nfl",
      category: "other",
      sectionType: "other",
      reason: "shallow_nfl_landing",
      signals: {
        hasDateInUrl: hasDateInUrl,
        hasPublishedMeta: signals.hasPublishedMeta,
        hasArticleSchema: signals.hasArticleSchema,
        hasFantasyKeyword,
        hasNFLKeyword,
        pathDepth: depth,
        looksStaticRanking,
        looksSectionHub: false,
      },
    };
  }

  if (looksLikePlayerPageUrl(u.href)) {
    return {
      decision: "include_player_page",
      league: /nfl/i.test(`${u.hostname}${u.pathname}${title ?? ""}`) ? "nfl" : "other",
      category: "other",
      reason: "player_page_pattern",
      signals: {
        hasDateInUrl: DATE_IN_URL.test(u.pathname),
        hasPublishedMeta: signals.hasPublishedMeta,
        hasArticleSchema: signals.hasArticleSchema,
        hasFantasyKeyword: FANTASY_FOOTBALL.test(`${u.pathname} ${title ?? ""}`),
        hasNFLKeyword: NFL_WORD.test(`${u.pathname} ${title ?? ""}`),
        pathDepth: u.pathname.split("/").filter(Boolean).length,
        looksStaticRanking: looksStaticRankingFrom(`${u.pathname} ${title ?? ""}`),
        looksSectionHub: false,
      },
    };
  }

  return { decision: "discard", reason: "weak_signals" };
}
