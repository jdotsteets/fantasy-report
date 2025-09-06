// lib/classify.ts

// Canonical section/topic tags we store in the DB
export type Topic =
  | "rankings"
  | "start-sit"
  | "waiver-wire"
  | "injury"
  | "dfs"
  | "advice";

export type Classification = {
  primary: Topic | null;     // null => general/news
  secondary: Topic | null;   // never equal to primary
  topics: string[];          // flat tag list (sleepers, week:1, draft-prep, etc.)
  confidence: number;
  week: number | null;
};

type Input = {
  title?: string | null;
  summary?: string | null;
  url?: string | null;         // URL fully used (path & query)
  sourceName?: string | null;
  week?: number | null;
};

const has = (re: RegExp, s: string) => re.test(s);

// ────────────────────────────────────────────────────────────────────────────
// Regex bank (URL-friendly; tolerant to hyphen/underscore/slash/space)
const RE = {
  // week in title or URL: week-3, wk_03, week3, etc.
  week: /\b(?:wk|week)[\s\-._]*([0-9]{1,2})\b/i,

  waiver:
    /\b(waiver(?:[\s\-_]*wire)?|waivers?|pick[\s\-_]*ups?|adds?|drop(?:s|[\s\-_]*adds?)?|streamers?|faab|stash(?:es)?|deep[\s\-_]*adds?)\b/i,

  rankings:
    /\b(ranking|rankings|top[\s\-_]*\d+\s*(rb|wr|te|qb|dst|k)?|tiers?|big[\s\-_]*board|cheat[\s\-_]*sheet|ecr)\b/i,

  startsit:
    /\b(start[\s\-_\/]*sit|sit[\s\-_\/]*start|who[\s\-_]*to[\s\-_]*start|who[\s\-_]*to[\s\-_]*sit)\b/i,

  sleepers: /\bsleeper(?:s)?\b/i,

  trade:
    /\b(trade(?:s|d)?|buy[\s\-_]*low|sell[\s\-_]*high|buy\/sell|trade[\s\-_]*targets?)\b/i,

  injury:
    /\b(injur(?:y|ies)|questionable|doubtful|out[\s\-_]*for|placed[\s\-_]*on[\s\-_]*(?:ir|pup|nfi)|activated|designation|concussion|acl|mcl|hamstring|ankle|groin|illness|inactives?)\b/i,

  dfs: /\b(dfs|draftkings|fan(?:duel|[\s\-_]*duel)|lineups?|cash[\s\-_]*game|gpp|value[\s\-_]*plays?|optimizer)\b/i,

  advice:
    /\b(advice|tips?|guide|strategy|strategies|how[\s\-_]*to|primer|busts?|breakouts?|targets?|avoid|must[\s\-_]?draft|adp(?:[\s\-_]*(risers|fallers))?|auction|keeper|dynasty)\b/i,

  // explicit draft-prep bucket (flat topic only; primary remains one of Topic)
  draftprep:
    /\b(mock[\s\-_]*drafts?|mock[\s\-_]*draft|draft[\s\-_]*(kit|guide|strategy|plan|tips|targets|values|board)|cheat[\s\-_]*sheets?)\b/i,

  // dampeners (used only in the fallback score path)
  notWaiver:
    /\b(practice|camp|training[\s\-_]*camp|press[\s\-_]*conference|injur(?:y|ies)|transaction|signs?|re[\s\-_]*signs?|agrees[\s\-_]*to|extension|arrested|suspended)\b/i,

  promoOrBetting:
    /\b(promo|promotion|bonus[\s\-_]*code|sign[\s\-_]*up[\s\-_]*bonus|odds|best[\s\-_]*bets?|parlay|props?|sportsbook|betting)\b/i,

  notAdvice:
    /\b(injur(?:y|ies)|questionable|doubtful|out[\s\-_]*for|placed[\s\-_]*on[\s\-_]*(?:ir|pup|nfi)|activated|depth[\s\-_]*chart|status[\s\-_]*report)\b/i,
};

// “Explicit-in-title-or-URL” detectors.
// Order is the *priority* for choosing primary when multiple fire.
const EXPLICIT_PRIORITY: { re: RegExp; topic: Topic }[] = [
  { re: RE.sleepers, topic: "start-sit" }, // sleepers maps to start-sit, checked FIRST
  { re: RE.startsit, topic: "start-sit" },
  { re: RE.waiver,   topic: "waiver-wire" },
  { re: RE.rankings, topic: "rankings" },
  { re: RE.injury,   topic: "injury" },
  { re: RE.dfs,      topic: "dfs" },
  { re: RE.advice,   topic: "advice" },
];

// soft source priors (used only in fallback)
const SOURCE_HINTS: Record<string, Partial<Record<Topic, number>>> = {
  "Sharp Football": { rankings: 0.15, dfs: 0.15, advice: 0.1 },
  "Razzball (NFL)": { "waiver-wire": 0.15, rankings: 0.15, advice: 0.1 },
  "Rotoballer NFL": { "waiver-wire": 0.15, rankings: 0.15, advice: 0.1 },
  "ESPN Fantasy": { advice: 0.05 },
  "Yahoo Sports NFL": { advice: 0.05 },
};

// week extraction from any blob
function extractWeek(text: string): number | null {
  const m = text.match(RE.week);
  if (!m) return null;
  const w = Number(m[1]);
  return Number.isFinite(w) ? w : null;
}

export function classifyArticle(input: Input): Classification {
  const title = (input.title ?? "").trim();
  const summary = (input.summary ?? "").trim();
  const rawUrl = (input.url ?? "").trim();

  // normalize URL parts to search (path + query only)
  let urlParts = "";
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      urlParts = `${u.pathname} ${u.search}`.toLowerCase();
    } catch {
      urlParts = rawUrl.toLowerCase();
    }
  }

  const blob = `${title}\n${summary}`.toLowerCase();
  const titleUrl = `${title} ${urlParts}`.toLowerCase();
  const allText = `${title} ${summary} ${urlParts}`.toLowerCase();

  // ——————————————————————————————————————————————————————————————
  // PHASE 1: Explicit-first branch (no scores/thresholds)
  // If explicit keywords exist in title/URL, set primary/secondary directly.
  const explicitHits: Topic[] = [];
  for (const { re, topic } of EXPLICIT_PRIORITY) {
    if (re.test(titleUrl)) explicitHits.push(topic);
  }
  // de-dupe explicit hits while preserving order
  const seen = new Set<Topic>();
  const explicitOrdered = explicitHits.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));

  // Build flat topics from explicit hits (plus related tags)
  const flatTopics = new Set<string>(["nfl"]);
  if (RE.rankings.test(allText)) flatTopics.add("rankings");
  if (RE.startsit.test(allText) || RE.sleepers.test(allText)) {
    flatTopics.add("start-sit");
  }
  if (RE.sleepers.test(allText)) flatTopics.add("sleepers");
  if (RE.waiver.test(allText))   flatTopics.add("waiver-wire");
  if (RE.injury.test(allText))   flatTopics.add("injury");
  if (RE.dfs.test(allText))      flatTopics.add("dfs");
  if (RE.advice.test(allText) || RE.trade.test(allText)) flatTopics.add("advice");
  if (RE.draftprep.test(allText)) flatTopics.add("draft-prep");

  // week from title/summary/url
  const week =
    input.week ??
    extractWeek(allText);

  if (week != null) flatTopics.add(`week:${week}`);

  if (explicitOrdered.length > 0) {
    // Primary is the first hit by priority; secondary is the next distinct hit if present
    const primary = explicitOrdered[0]!;
    const secondary = explicitOrdered.find((t) => t !== primary) ?? null;

    return {
      primary,
      secondary,
      topics: [...flatTopics],
      confidence: 0.95, // explicit keywords → high confidence
      week: week ?? null,
    };
  }

  // ——————————————————————————————————————————————————————————————
  // PHASE 2: Fallback scoring (when explicit keywords are absent)
  const score: Record<Topic, number> = {
    "waiver-wire": 0,
    rankings: 0,
    "start-sit": 0,
    injury: 0,
    dfs: 0,
    advice: 0,
  };

  // Whitelist hits on title/summary and URL-aware
  const hit = {
    waiver:   has(RE.waiver, blob)   || has(RE.waiver, titleUrl),
    rankings: has(RE.rankings, blob) || has(RE.rankings, titleUrl),
    startsit: has(RE.startsit, blob) || has(RE.startsit, titleUrl),
    sleepers: has(RE.sleepers, blob) || has(RE.sleepers, titleUrl),
    trade:    has(RE.trade, blob)    || has(RE.trade, titleUrl),
    injury:   has(RE.injury, blob)   || has(RE.injury, titleUrl),
    dfs:      has(RE.dfs, blob)      || has(RE.dfs, titleUrl),
    advice:   has(RE.advice, blob)   || has(RE.advice, titleUrl),
    draftprep:has(RE.draftprep, blob)|| has(RE.draftprep, titleUrl),
  };

  if (hit.rankings) flatTopics.add("rankings");
  if (hit.startsit || hit.sleepers) flatTopics.add("start-sit");
  if (hit.sleepers) flatTopics.add("sleepers");
  if (hit.waiver) flatTopics.add("waiver-wire");
  if (hit.injury) flatTopics.add("injury");
  if (hit.dfs) flatTopics.add("dfs");
  if (hit.advice || hit.trade) flatTopics.add("advice");
  if (hit.draftprep) flatTopics.add("draft-prep");

  // scoring (URL hits included implicitly via hit.*)
  if (hit.waiver)   score["waiver-wire"] += 1.0;
  if (hit.rankings) score.rankings       += 1.0;
  if (hit.startsit) score["start-sit"]   += 1.0;
  if (hit.sleepers) score["start-sit"]   += 0.9; // strong nudge
  if (hit.injury)   score.injury         += 1.0;
  if (hit.dfs)      score.dfs            += 1.0;
  if (hit.advice)   score.advice         += 0.9;
  if (hit.trade)    score.advice         += 0.6;

  // dampeners
  if (score["waiver-wire"] > 0 && has(RE.notWaiver, blob)) score["waiver-wire"] -= 0.8;
  if (score.dfs > 0 && has(RE.promoOrBetting, blob))       score.dfs           -= 0.8;
  if (score.advice > 0 && has(RE.notAdvice, blob))         score.advice        -= 0.8;
  if (has(RE.promoOrBetting, blob)) score.advice = Math.min(score.advice, 0.2);

  // waiver must be explicit; hints can’t force it
  if (!hit.waiver) score["waiver-wire"] = Math.min(score["waiver-wire"], 0.15);

  // soft source priors
  const hints = input.sourceName ? SOURCE_HINTS[input.sourceName] : undefined;
  if (hints) for (const [k, v] of Object.entries(hints)) score[k as Topic] += v ?? 0;

  // choose primary by score (softer thresholds than original)
  const ordered = (Object.entries(score) as [Topic, number][])
    .sort((a, b) => b[1] - a[1]);

  const [bestKey, bestScore] = ordered[0]!;
  const [secondKey, secondScore] = ordered[1]!;

  const MIN_PRIMARY = 0.80;
  const MIN_SECOND  = 0.60;
  const CLOSE_RATIO = 0.55;

  const primary: Topic | null = bestScore >= MIN_PRIMARY ? bestKey : null;

  // For secondary, prefer an actually strong #2 that’s close to #1
  let secondary: Topic | null = null;
  if (primary) {
    if (
      secondKey !== primary &&
      secondScore >= MIN_SECOND &&
      secondScore >= bestScore * CLOSE_RATIO
    ) {
      secondary = secondKey;
    }
  }

  const confidence = Math.max(0.1, Math.min(0.99, bestScore));

  // If nothing cleared the bar, keep primary null (general/news)
  const anyMeaningful =
    bestScore >= MIN_PRIMARY ||
    secondScore >= MIN_PRIMARY ||
    ordered.some(([, v]) => v >= MIN_PRIMARY);

  return {
    primary: anyMeaningful ? primary : null,
    secondary,
    topics: [...flatTopics],
    confidence,
    week: week ?? null,
  };
}
