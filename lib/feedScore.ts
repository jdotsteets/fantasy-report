// lib/feedScore.ts
// Feed article scoring for homepage curation
// Combines freshness + context importance + season awareness

import type { TrendContext, SeasonMode } from "@/lib/trending";
import type { Article } from "@/types/sources";

// Context importance weights (base scores)
const CONTEXT_WEIGHTS: Record<string, number> = {
  // High importance (injury/workload/role changes)
  injury: 100,
  workload: 90,
  starting_role: 85,
  depth_chart: 80,
  transaction: 75,
  
  // Medium importance (actionable fantasy)
  waiver: 70,
  start_sit: 65,
  trade: 65,
  signing: 60,
  breakout: 55,
  
  // Lower importance (context-dependent)
  coach_speak: 45,
  dfs: 40,
  ranking: 35,
  rookie: 30,
  
  // Lowest importance (off-season noise)
  mock_draft: 20,
  landing_spot: 25,
  generic_news: 15,
};

// Season-specific boosts
const SEASON_BOOSTS: Record<SeasonMode, Partial<Record<string, number>>> = {
  regular: {
    injury: 1.5,
    workload: 1.4,
    starting_role: 1.3,
    depth_chart: 1.3,
    waiver: 1.2,
    start_sit: 1.2,
  },
  'off-season': {
    signing: 1.3,
    trade: 1.3,
    transaction: 1.2,
    mock_draft: 0.6, // Reduce in feed
    landing_spot: 0.7,
  },
  preseason: {
    starting_role: 1.4,
    depth_chart: 1.3,
    coach_speak: 1.2,
    breakout: 1.2,
  },
};

// Detect article context from title + primary_topic
function detectArticleContext(article: Article): string {
  const text = `${article.title || ''} ${article.primary_topic || ''}`.toLowerCase();
  
  // Check in priority order
  if (/injur|IR|questionable|doubtful|out for|ruled out/.test(text)) return 'injury';
  if (/workload|touches|target share|snap|usage|volume/.test(text)) return 'workload';
  if (/start|bench|lead back|workhorse|bellcow|three-down/.test(text)) return 'starting_role';
  if (/depth chart|rb1|wr1|rotation|pecking order/.test(text)) return 'depth_chart';
  if (/waiver|pickup|add|drop|stream|available/.test(text)) return 'waiver';
  if (/start.sit|must.start|lineup|play or sit/.test(text)) return 'start_sit';
  if (/trade|dealt|acquire|swap|package/.test(text)) return 'trade';
  if (/sign|contract|extension|free agent/.test(text)) return 'signing';
  if (/transaction|release|cut|claim/.test(text)) return 'transaction';
  if (/breakout|sleeper|emerge|stock up/.test(text)) return 'breakout';
  if (/coach|said|comment|feature|plan/.test(text)) return 'coach_speak';
  if (/dfs|draftkings|fanduel|gpp/.test(text)) return 'dfs';
  if (/rank|tier|top.*rb|top.*wr/.test(text)) return 'ranking';
  if (/rookie|draft class|first.year/.test(text)) return 'rookie';
  if (/mock draft|adp|draft strategy/.test(text)) return 'mock_draft';
  if (/landing spot|fit|scheme|situation/.test(text)) return 'landing_spot';
  
  return 'generic_news';
}

// Calculate feed score for an article
export function calculateFeedScore(
  article: Article,
  seasonMode: SeasonMode,
): number {
  // 1. Context detection
  const context = detectArticleContext(article);
  const baseWeight = CONTEXT_WEIGHTS[context] || 10;
  
  // 2. Season boost
  const seasonBoost = SEASON_BOOSTS[seasonMode];
  const boost = seasonBoost[context] || 1.0;
  
  // 3. Freshness (hours old)
  const now = Date.now();
  const articleDate = article.published_at || article.discovered_at;
  const ageHours = articleDate
    ? (now - new Date(articleDate).getTime()) / (1000 * 60 * 60)
    : 999;
  
  // Exponential decay: 0.5^(age/12)
  const freshness = Math.pow(0.5, ageHours / 12);
  
  // 4. Quality score (if available)
  const quality = (article.score || 50) / 100;
  
  // Final score: context * boost * freshness * quality
  const score = baseWeight * boost * freshness * quality;
  
  return Math.round(score * 100) / 100;
}

// Score and sort articles
export function scoreAndSortArticles(
  articles: Article[],
  seasonMode: SeasonMode,
): Array<Article & { feedScore: number; context: string }> {
  return articles
    .map(article => ({
      ...article,
      feedScore: calculateFeedScore(article, seasonMode),
      context: detectArticleContext(article),
    }))
    .sort((a, b) => b.feedScore - a.feedScore);
}

// Balance feed by content type (prevent draft domination)
export function balanceFeed(
  scoredArticles: Array<Article & { feedScore: number; context: string }>,
  seasonMode: SeasonMode,
  maxItems: number = 14,
): Article[] {
  if (seasonMode !== 'off-season') {
    // No special balancing needed in regular/preseason
    return scoredArticles.slice(0, maxItems);
  }
  
  // Off-season: cap draft/mock content at 40%
  const maxDraftMock = Math.floor(maxItems * 0.4);
  
  const result: Article[] = [];
  let draftMockCount = 0;
  
  for (const article of scoredArticles) {
    if (result.length >= maxItems) break;
    
    const isDraftMock = article.context === 'mock_draft' || 
                        article.context === 'landing_spot' ||
                        article.context === 'rookie';
    
    if (isDraftMock) {
      if (draftMockCount < maxDraftMock) {
        result.push(article);
        draftMockCount++;
      }
      // Skip if over limit
    } else {
      result.push(article);
    }
  }
  
  // If we didn't fill the feed, add more draft content
  if (result.length < maxItems) {
    const remaining = scoredArticles
      .filter(a => !result.includes(a))
      .slice(0, maxItems - result.length);
    result.push(...remaining);
  }
  
  return result;
}
// Extension to lib/feedScore.ts
// Cluster-aware feed selection + context descriptions

import type { TrendCluster } from "@/lib/trending";

// Context descriptions for "why it matters"
const CONTEXT_DESCRIPTIONS: Record<string, string> = {
  injury: "Injury update — may impact availability and workload",
  workload: "Usage trend — target share or snap count shift",
  starting_role: "Role change — could affect fantasy value",
  depth_chart: "Depth chart shift — playing time implications",
  waiver: "Waiver wire — pickup opportunity",
  start_sit: "Start/sit advice — lineup decision help",
  trade: "Trade news — new team situation",
  signing: "Signing — landing spot and opportunity",
  transaction: "Transaction — roster move",
  breakout: "Breakout candidate — emerging value",
  coach_speak: "Coach comments — usage hints",
  dfs: "DFS play — daily fantasy angle",
  ranking: "Rankings update — rest-of-season outlook",
  rookie: "Rookie news — year-one expectations",
  mock_draft: "Mock draft — draft strategy",
  landing_spot: "Landing spot analysis — team fit",
  generic_news: "Latest update",
};

// Get "why it matters" description
export function getContextDescription(context: string): string {
  return CONTEXT_DESCRIPTIONS[context] || "Latest update";
}

// Select best article from each trending cluster
export function selectClusterRepresentatives(
  clusters: TrendCluster[],
  scoredArticles: any[],
): any[] {
  const articleMap = new Map<number, any>();
  scoredArticles.forEach(a => articleMap.set(a.id, a));
  
  const selected: any[] = [];
  const usedIds = new Set<number>();
  
  for (const cluster of clusters) {
    const clusterArticles = cluster.articleIds
      .map(id => articleMap.get(id))
      .filter(a => a && !usedIds.has(a.id));
    
    if (clusterArticles.length > 0) {
      const best = clusterArticles.reduce((prev, curr) => {
        const prevScore = prev.feedScore || 0;
        const currScore = curr.feedScore || 0;
        return currScore > prevScore ? curr : prev;
      });
      
      selected.push(best);
      usedIds.add(best.id);
    }
  }
  
  return selected;
}

// Global dedupe: remove articles already used in hero/feed from sections
export function globalDedupe<T extends { id: number }>(
  sections: Record<string, T[]>,
  usedIds: Set<number>,
): Record<string, T[]> {
  const deduped: Record<string, T[]> = {};
  
  for (const [key, items] of Object.entries(sections)) {
    deduped[key] = items.filter(item => !usedIds.has(item.id));
  }
  
  return deduped;
}

