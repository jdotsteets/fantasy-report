// lib/classify.ts
export type Classification = {
  category: "waiver" | "rankings" | "start_sit" | "trade" | "injury" | "dfs" | "news" | "advice";
  topics: string[];
  confidence: number;
};

type Input = {
  title?: string | null;
  summary?: string | null;
  sourceName?: string | null;
  week?: number | null;
};

// Reusable helpers
const has = (re: RegExp, s: string) => re.test(s);

// Core patterns
const RE = {
  week: /\bweek\s*(\d{1,2})\b/i,

  // Primary whitelist patterns
  waiver: /\b(waiver\s*wire|pick\s*ups?|adds?|streamers?|deep\s*adds?|stash(?:es)?|FAAB|sleepers?|targets?|spec\s*adds?|roster\s*moves?)\b/i,
  rankings: /\b(ranking|rankings|top\s*\d+\s*(rb|wr|te|qb|dst|k)?|tiers?)\b/i,
  startsit: /\b(start\/?sit|start(?:s)?\s+and\s+sit(?:s)?|who\s+to\s+start|who\s+to\s+sit)\b/i,
  trade: /\b(trade(?:s|d)?|buy\s*low|sell\s*high|buy\/sell|trade\s*targets?)\b/i,
  injury: /\b(injury|injured|out\s+for\s+|placed\s+on\s+ir|tore\s+|ruptured|sidelined|inactive|questionable|doubtful|hamstring|acl|mcl|concussion)\b/i,
  dfs: /\b(dfs|draftkings|fanduel|lineups?|cash\s*game|gpp|value\s*plays?)\b/i,
  advice: /\b(advice|tips?|guide|strategy|strategies|help)\b/i,

  // Blacklist for waiver
  notWaiver: /\b(practice|camp|training\s*camp|beat\s*report|press\s*conference|injury|injured|trade|transaction|signs?|re-signs?|agrees\s+to|extension|arrested|suspended)\b/i,
};

// Optional source hints
const SOURCE_HINTS: Record<string, Partial<Record<Classification["category"], number>>> = {
  "Sharp Football": { rankings: 0.2, dfs: 0.2, advice: 0.2 },
  "Razzball (NFL)": { waiver: 0.2, rankings: 0.2, advice: 0.2 },
  "Rotoballer NFL": { waiver: 0.2, rankings: 0.2, advice: 0.2 },
  "ESPN Fantasy":   { news: 0.2, advice: 0.1 },
  "Yahoo Sports NFL": { news: 0.2, advice: 0.1 },
};

function extractWeek(text: string): number | null {
  const m = text.match(RE.week);
  if (!m) return null;
  const w = Number(m[1]);
  return Number.isFinite(w) ? w : null;
}

// Main classifier
export function classifyArticle(input: Input): Classification {
  const title = (input.title ?? "").trim();
  const summary = (input.summary ?? "").trim();
  const blob = `${title}\n${summary}`;
  const lower = blob.toLowerCase();

  const score: Record<Classification["category"], number> = {
    waiver: 0, rankings: 0, start_sit: 0, trade: 0, injury: 0, dfs: 0, news: 0, advice: 0,
  };

  // Whitelist hits
  if (has(RE.waiver, blob))   score.waiver += 1.0;
  if (has(RE.rankings, blob)) score.rankings += 1.0;
  if (has(RE.startsit, blob)) score.start_sit += 1.0;
  if (has(RE.trade, blob))    score.trade += 1.0;
  if (has(RE.injury, blob))   score.injury += 1.0;
  if (has(RE.dfs, blob))      score.dfs += 1.0;
  if (has(RE.advice, blob))   score.advice += 0.8;

  // Blacklist for waiver
  if (score.waiver > 0 && has(RE.notWaiver, blob)) score.waiver -= 0.8;

  // Source priors
  const hints = input.sourceName ? SOURCE_HINTS[input.sourceName] : undefined;
  if (hints) {
    for (const [k, v] of Object.entries(hints)) {
      score[k as Classification["category"]] += v ?? 0;
    }
  }

  // Default to news
  const sum = Object.values(score).reduce((a, b) => a + b, 0);
  if (sum === 0) score.news = 0.5;

  // Pick best
  let best: Classification["category"] = "news";
  let bestScore = -Infinity;
  for (const [k, v] of Object.entries(score)) {
    if (v > bestScore) { best = k as Classification["category"]; bestScore = v; }
  }

  // Topics
  const topics = new Set<string>(["nfl", best]);
  const week = input.week ?? extractWeek(lower);
  if (week != null) topics.add(`week:${week}`);

  return { category: best, topics: Array.from(topics), confidence: Math.max(0, Math.min(1, bestScore)) };
}
