// lib/scoring.ts
// Article quality scoring for ingest prioritization
// Uses existing 'score' field (numeric) in articles table

export type ScoringInput = {
  title: string;
  url: string;
  domain: string | null;
  sourceId?: number;
  primary_topic?: string | null;
  secondary_topic?: string | null;
  players?: string[] | null;
  published_at?: string | null;
  discovered_at?: string | null;
};

// Trusted fantasy sources (boost factor: +20 points)
const TRUSTED_SOURCES = new Set([
  'fantasypros.com',
  'rotoballer.com',
  'rotowire.com',
  'pff.com',
  'footballguys.com',
  'thefantasyfootballers.com',
  'razzball.com',
  'nbcsports.com',
  'espn.com',
  'theringer.com',
  'theathletic.com',
]);

// Actionable content indicators (boost factor: +15 points)
const ACTIONABLE_PATTERNS = [
  /(start|sit|lineup|must-start|must-sit|sleeper|bust)/i,
  /(waiver|pickup|add|drop|stash|target)/i,
  /(trade|buy low|sell high|value|overvalued|undervalued)/i,
  /(breakout|bounce back|regression|outlook|projection)/i,
  /(week \d+|ros|rest of season)/i,
];

// Specific topics are more valuable than generic (boost factor: +10 points)
const SPECIFIC_TOPICS = new Set([
  'start-sit',
  'waiver-wire',
  'injury',
  'dfs',
  'rankings',
]);

// Generic/low-value indicators (penalty: -10 to -20 points)
const LOW_VALUE_PATTERNS = [
  /(recap|highlights|score|final score|game thread)/i,
  /(live updates|live blog|watch|stream|tv schedule)/i,
  /(podcast|radio|interview|transcript)/i,
  /(odds|spread|line|betting|parlay)/i,
];

/**
 * Calculate article quality score (0-100 scale)
 * Higher = better quality/more fantasy-relevant
 * 
 * NOTE: This score represents QUALITY only, not recency.
 * Time decay is applied dynamically in SQL ORDER BY clauses.
 * Scores remain stable over time (no freshness decay baked in).
 */
export function calculateArticleScore(input: ScoringInput): number {
  let score = 50; // Base score

  const titleLower = input.title.toLowerCase();
  const urlLower = input.url.toLowerCase();
  const domain = input.domain?.toLowerCase() || '';

  // 1. Source quality (+20 for trusted sources)
  if (TRUSTED_SOURCES.has(domain)) {
    score += 20;
  }

  // 2. Actionable content (+15)
  const hasActionable = ACTIONABLE_PATTERNS.some(rx => rx.test(titleLower));
  if (hasActionable) {
    score += 15;
  }

  // 3. Topic specificity (+10 for specific topics)
  if (input.primary_topic && SPECIFIC_TOPICS.has(input.primary_topic)) {
    score += 10;
  }

  // 4. Entity presence (+5 per player, max +15)
  const playerCount = input.players?.length || 0;
  if (playerCount > 0) {
    score += Math.min(playerCount * 5, 15);
  }

  // 5. Low-value penalty (-10 to -20)
  const hasLowValue = LOW_VALUE_PATTERNS.some(rx => rx.test(titleLower) || rx.test(urlLower));
  if (hasLowValue) {
    score -= 15;
  }

  // 6. Generic news penalty (if no specific topic and no players)
  if (input.primary_topic === 'news' && playerCount === 0) {
    score -= 5;
  }

  // 7. Depth penalty (very long URLs = likely deep navigation, not main content)
  const pathSegments = new URL(input.url).pathname.split('/').filter(Boolean);
  if (pathSegments.length > 6) {
    score -= 5;
  }

  // Clamp to 0-100 range
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Batch scoring for multiple articles
 */
export function scoreArticles(inputs: ScoringInput[]): Map<string, number> {
  const scores = new Map<string, number>();
  
  for (const input of inputs) {
    const key = input.url;
    scores.set(key, calculateArticleScore(input));
  }
  
  return scores;
}
