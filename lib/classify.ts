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
  topics: string[];          // flat tag list (sleepers, week:1, etc.)
  confidence: number;
  week: number | null;
};

type Input = {
  title?: string | null;
  summary?: string | null;
  url?: string | null;         // <-- NEW: use URL for explicit keyword hits
  sourceName?: string | null;
  week?: number | null;
};

const has = (re: RegExp, s: string) => re.test(s);

const RE = {
  week: /\bweek\s*(\d{1,2})\b/i,

  waiver:
    /\b(waiver(?:\s*wire)?|waivers|pick[\s-]*ups?|adds?|drop(?:s|\/adds?)?|streamers?|faab|stash(?:es)?|deep\s*adds?)\b/i,

  rankings:
    /\b(ranking|rankings|top\s*\d+\s*(rb|wr|te|qb|dst|k)?|tiers?|big\s*board|cheat\s*sheet)\b/i,

  startsit: /\b(start\/?sit|start(?:s)?\s+and\s+sit(?:s)?|who\s+to\s+start|who\s+to\s+sit)\b/i,
  sleepers: /\bsleeper(?:s)?\b/i,

  trade: /\b(trade(?:s|d)?|buy\s*low|sell\s*high|buy\/sell|trade\s*targets?)\b/i,

  injury:
    /\b(injur(?:y|ies)|questionable|doubtful|out\s+for|placed\s+on\s+(?:ir|pup|nfi)|activated|designation|concussion|acl|mcl|hamstring|ankle|groin|illness)\b/i,

  dfs: /\b(dfs|draftkings|fan(?:duel| duel)|lineups?|cash\s*game|gpp|value\s*plays?|optimizer)\b/i,

  advice:
    /\b(advice|tips?|guide|strategy|strategies|how\s*to|primer|draft(?:\s*strategy)?|mock\s*draft|busts?|breakouts?|targets?|avoid|must-?draft|adp(?:\s*(risers|fallers))?|auction|keeper|dynasty)\b/i,

  // dampeners
  notWaiver:
    /\b(practice|camp|training\s*camp|press\s*conference|injur(?:y|ies)|transaction|signs?|re-signs?|agrees\s+to|extension|arrested|suspended)\b/i,

  promoOrBetting:
    /\b(promo|promotion|bonus\s*code|sign[-\s]*up\s*bonus|odds|best\s*bets?|parlay|props?|sportsbook|betting)\b/i,

  notAdvice:
    /\b(injur(?:y|ies)|questionable|doubtful|out\s+for|placed\s+on\s+(?:ir|pup|nfi)|activated|depth\s*chart|status\s*report)\b/i,
};

// “Explicit-in-title-or-URL” detectors (checked in this order for secondary)
const EXPLICIT = [
  { re: RE.sleepers,   topic: "start-sit" as const }, // sleepers ⇒ start-sit, checked FIRST
  { re: RE.startsit,   topic: "start-sit" as const },
  { re: RE.waiver,     topic: "waiver-wire" as const },
  { re: RE.rankings,   topic: "rankings" as const },
  { re: RE.injury,     topic: "injury" as const },
  { re: RE.dfs,        topic: "dfs" as const },
  { re: RE.advice,     topic: "advice" as const },
];

const SOURCE_HINTS: Record<string, Partial<Record<Topic, number>>> = {
  "Sharp Football": { rankings: 0.15, dfs: 0.15, advice: 0.1 },
  "Razzball (NFL)": { "waiver-wire": 0.15, rankings: 0.15, advice: 0.1 },
  "Rotoballer NFL": { "waiver-wire": 0.15, rankings: 0.15, advice: 0.1 },
  "ESPN Fantasy": { advice: 0.05 },
  "Yahoo Sports NFL": { advice: 0.05 },
};

function extractWeek(text: string): number | null {
  const m = text.match(RE.week);
  if (!m) return null;
  const w = Number(m[1]);
  return Number.isFinite(w) ? w : null;
}

export function classifyArticle(input: Input): Classification {
  const title = (input.title ?? "").trim();
  const summary = (input.summary ?? "").trim();
  const url = (input.url ?? "").trim();
  const blob = `${title}\n${summary}`;
  const titleUrl = `${title} ${url}`;

  // score the concrete sections
  const score: Record<Topic, number> = {
    "waiver-wire": 0,
    rankings: 0,
    "start-sit": 0,
    injury: 0,
    dfs: 0,
    advice: 0,
  };

  // whitelist hits
  const hit = {
    waiver: has(RE.waiver, blob) || has(RE.waiver, titleUrl),
    rankings: has(RE.rankings, blob) || has(RE.rankings, titleUrl),
    startsit: has(RE.startsit, blob) || has(RE.startsit, titleUrl),
    sleepers: has(RE.sleepers, blob) || has(RE.sleepers, titleUrl),
    trade: has(RE.trade, blob) || has(RE.trade, titleUrl),
    injury: has(RE.injury, blob) || has(RE.injury, titleUrl),
    dfs: has(RE.dfs, blob) || has(RE.dfs, titleUrl),
    advice: has(RE.advice, blob) || has(RE.advice, titleUrl),
  };

  if (hit.waiver)     score["waiver-wire"] += 1.0;
  if (hit.rankings)   score.rankings       += 1.0;
  if (hit.startsit)   score["start-sit"]   += 1.0;
  if (hit.sleepers)   score["start-sit"]   += 0.9;   // strong nudge for sleepers
  if (hit.injury)     score.injury         += 1.0;
  if (hit.dfs)        score.dfs            += 1.0;
  if (hit.advice)     score.advice         += 0.9;
  if (hit.trade)      score.advice         += 0.6;

  // dampeners
  if (score["waiver-wire"] > 0 && has(RE.notWaiver, blob)) score["waiver-wire"] -= 0.8;
  if (score.dfs > 0 && has(RE.promoOrBetting, blob))       score.dfs           -= 0.8;
  if (score.advice > 0 && has(RE.notAdvice, blob))         score.advice        -= 0.8;
  if (has(RE.promoOrBetting, blob)) score.advice = Math.min(score.advice, 0.2);

  // injury should edge out advice if both present
  if (score.injury > 0) score.advice = Math.min(score.advice, Math.max(0, score.injury - 0.1));

  // waiver must be explicit; hints can’t force it
  if (!hit.waiver) score["waiver-wire"] = Math.min(score["waiver-wire"], 0.15);

  // source hints (soft)
  const hints = input.sourceName ? SOURCE_HINTS[input.sourceName] : undefined;
  if (hints) for (const [k, v] of Object.entries(hints)) score[k as Topic] += v ?? 0;

  // choose primary by score (unchanged)
  const ordered = (Object.entries(score) as [Topic, number][])
    .sort((a, b) => b[1] - a[1]);

  const [bestKey, bestScore] = ordered[0]!;
  const [secondKey, secondScore] = ordered[1]!;

  const MIN_PRIMARY = 1.0;
  const MIN_SECOND  = 0.75;
  const CLOSE_RATIO = 0.70;

  const primary: Topic | null = bestScore >= MIN_PRIMARY ? bestKey : null;

  // explicit topic from title/URL (sleepers checked FIRST so it wins)
  let explicit: Topic | null = null;
  for (const e of EXPLICIT) {
    if (e.re.test(titleUrl)) { explicit = e.topic; break; }
  }

  // secondary precedence:
  // 1) explicit (if different from primary),
  // 2) otherwise the second-best score if strong & close.
  let secondary: Topic | null = null;
  if (primary) {
    if (explicit && explicit !== primary) {
      secondary = explicit;
    } else if (
      secondKey !== primary &&
      secondScore >= MIN_SECOND &&
      secondScore >= bestScore * CLOSE_RATIO
    ) {
      secondary = secondKey;
    }
  }

  // flat topics
  const topics = new Set<string>(["nfl"]);
  if (hit.rankings) topics.add("rankings");
  if (hit.startsit || hit.sleepers) topics.add("start-sit");
  if (hit.sleepers) topics.add("sleepers");
  if (hit.waiver) topics.add("waiver-wire");
  if (hit.injury) topics.add("injury");
  if (hit.dfs) topics.add("dfs");
  if (hit.advice || hit.trade) topics.add("advice");

  const week = input.week ?? extractWeek((title + " " + summary).toLowerCase());
  if (week != null) topics.add(`week:${week}`);

  const confidence = Math.max(0.1, Math.min(0.99, bestScore));

  // If nothing cleared the bar, keep primary null (i.e., general/latest/news)
  const anyMeaningful =
    bestScore >= MIN_PRIMARY ||
    secondScore >= MIN_PRIMARY ||
    ordered.some(([, v]) => v >= MIN_PRIMARY);

  return {
    primary: anyMeaningful ? primary : null,
    secondary,
    topics: [...topics],
    confidence,
    week: week ?? null,
  };
}
