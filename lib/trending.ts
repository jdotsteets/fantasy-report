// lib/trending.ts
// Server-side trending intelligence for fantasy football
// Clusters related articles by entity + context with smart scoring

export type SeasonMode = 'regular' | 'off-season' | 'preseason';

export type TrendContext =
  | 'injury'
  | 'workload'
  | 'depth_chart'
  | 'starting_role'
  | 'transaction'
  | 'trade'
  | 'signing'
  | 'waiver'
  | 'start_sit'
  | 'breakout'
  | 'rookie'
  | 'mock_draft'
  | 'landing_spot'
  | 'coach_speak'
  | 'dfs'
  | 'ranking'
  | 'generic_news';

export type TrendEntityType = 'player' | 'team' | 'topic';

export type TrendCluster = {
  key: string; // Stable identifier: player:saquon-barkley:workload
  entityType: TrendEntityType;
  entityName: string; // Display name: Saquon Barkley
  entitySlug: string; // URL-safe: saquon-barkley
  context: TrendContext;
  contextLabel: string; // Human readable: workload concern
  label: string; // Full label: Saquon Barkley workload concern
  articleCount: number;
  sourceCount: number;
  articleIds: number[];
  score: number;
  freshness: number; // Hours since most recent article
  debug: {
    avgQuality: number;
    seasonBoost: number;
    contextPriority: number;
    timeDecay: number;
    sources: string[];
  };
};

export type ArticleInput = {
  id: number;
  title: string;
  url: string;
  domain: string | null;
  published_at: string | null;
  discovered_at?: string | null;
  primary_topic?: string | null;
  secondary_topic?: string | null;
  topics?: readonly string[] | string[] | null;
  players?: readonly string[] | string[] | null | [];
  score?: number | null;
  source?: string | null;
};

// Context detection patterns
const CONTEXT_PATTERNS: Record<TrendContext, RegExp[]> = {
  injury: [
    /\b(injur|IR|questionable|doubtful|out for|ruled out|miss|sidelined|return|recovery|rehab)\b/i,
  ],
  workload: [
    /\b(touches|target share|snap|usage|workload|volume|carry|target|involvement)\b/i,
  ],
  depth_chart: [
    /\b(depth chart|starter|backup|rb1|rb2|wr1|rotation|pecking order)\b/i,
  ],
  starting_role: [
    /\b(start|bench|lead back|lead role|three-down|workhorse|bellcow)\b/i,
  ],
  transaction: [
    /\b(transaction|release|cut|claim|sign|add|designate)\b/i,
  ],
  trade: [
    /\b(trade|dealt|acquire|swap|package|sent to)\b/i,
  ],
  signing: [
    /\b(sign|contract|extension|deal|agree|terms|free agent)\b/i,
  ],
  waiver: [
    /\b(waiver|pickup|add|drop|stream|under\.owned|available)\b/i,
  ],
  start_sit: [
    /\b(start|sit|must\.start|must\.sit|lineup|play|bench)\b/i,
  ],
  breakout: [
    /\b(breakout|sleeper|emerge|rising|stock up|buy low|undervalue)\b/i,
  ],
  rookie: [
    /\b(rookie|first\.year|draft class|rookie outlook)\b/i,
  ],
  mock_draft: [
    /\b(mock draft|draft board|big board|adp|draft strategy)\b/i,
  ],
  landing_spot: [
    /\b(landing spot|fit|scheme|situation|opportunity|join|move to)\b/i,
  ],
  coach_speak: [
    /\b(coach|said|comment|hint|praise|confident|feature|plan)\b/i,
  ],
  dfs: [
    /\b(dfs|draftkings|fanduel|showdown|cash game|gpp|tournament|value play)\b/i,
  ],
  ranking: [
    /\b(rank|tier|top|bottom|ppr|standard|dynasty|redraft)\b/i,
  ],
  generic_news: [/.*/], // Catch-all
};

// Context labels for display
const CONTEXT_LABELS: Record<TrendContext, string> = {
  injury: 'injury update',
  workload: 'workload concern',
  depth_chart: 'depth chart shift',
  starting_role: 'starting role',
  transaction: 'transaction',
  trade: 'trade buzz',
  signing: 'signing impact',
  waiver: 'waiver target',
  start_sit: 'start/sit advice',
  breakout: 'breakout buzz',
  rookie: 'rookie outlook',
  mock_draft: 'mock draft buzz',
  landing_spot: 'landing spot analysis',
  coach_speak: 'coach comments',
  dfs: 'DFS play',
  ranking: 'rankings update',
  generic_news: 'news',
};

// Context priority by season
const SEASON_CONTEXT_PRIORITY: Record<SeasonMode, Partial<Record<TrendContext, number>>> = {
  regular: {
    injury: 1.5,
    workload: 1.4,
    depth_chart: 1.4,
    starting_role: 1.3,
    waiver: 1.3,
    start_sit: 1.5,
    transaction: 1.2,
    dfs: 1.1,
  },
  'off-season': {
    signing: 1.5,
    trade: 1.5,
    mock_draft: 1.4,
    landing_spot: 1.4,
    rookie: 1.3,
    depth_chart: 1.2,
  },
  preseason: {
    starting_role: 1.5,
    depth_chart: 1.4,
    injury: 1.3,
    rookie: 1.3,
    coach_speak: 1.2,
    breakout: 1.2,
  },
};

// Slugify for stable keys
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Extract player names from title
function extractPlayerNames(title: string, playersArray: readonly string[] | string[] | null | [] | undefined): string[] {
  const found = new Set<string>();
  
  // Use players array if available (handle all array types)
  if (playersArray && Array.isArray(playersArray) && playersArray.length > 0) {
    playersArray.forEach(p => found.add(p));
  }
  
  // Also try regex extraction for two-word names
  const twoWord = /\b([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15})\b/g;
  const skip = new Set([
    'Fantasy Football', 'New York', 'New England', 'New Orleans',
    'Los Angeles', 'San Francisco', 'Green Bay', 'Kansas City',
    'Las Vegas', 'Tampa Bay', 'Free Agency', 'Mock Draft',
    'Draft Kings', 'Fan Duel', 'Yahoo Sports', 'Pro Football',
    'Fantasy Report', 'The Athletic', 'Roto World', 'Fantasy Pros',
    'Running Backs', 'Wide Receivers', 'Tight Ends',
  ]);
  
  let m: RegExpExecArray | null;
  while ((m = twoWord.exec(title)) !== null) {
    const name = m[1];
    if (!skip.has(name) && name.split(' ').every(w => w.length >= 2 && w.length <= 12)) {
      found.add(name);
    }
  }
  
  return Array.from(found);
}

// Detect all matching contexts for an article
function detectContexts(article: ArticleInput): TrendContext[] {
  const text = `${article.title} ${article.primary_topic || ''} ${article.secondary_topic || ''}`.toLowerCase();
  const contexts: TrendContext[] = [];
  
  for (const [context, patterns] of Object.entries(CONTEXT_PATTERNS) as [TrendContext, RegExp[]][]) {
    if (patterns.some(p => p.test(text))) {
      contexts.push(context);
    }
  }
  
  // Avoid generic_news if we have specific contexts
  if (contexts.length > 1 && contexts.includes('generic_news')) {
    return contexts.filter(c => c !== 'generic_news');
  }
  
  return contexts.length > 0 ? contexts : ['generic_news'];
}

// Calculate time decay multiplier
function calculateTimeDecay(hoursOld: number): number {
  // Exponential decay: fresh articles get full weight, older decay quickly
  // 0h: 1.0, 6h: 0.71, 12h: 0.50, 24h: 0.25, 48h: 0.125
  return Math.pow(0.5, hoursOld / 12);
}

// Calculate article freshness in hours
function getArticleFreshness(article: ArticleInput): number {
  const now = Date.now();
  const articleDate = article.published_at || article.discovered_at;
  if (!articleDate) return 999; // Very old
  
  const ageMs = now - new Date(articleDate).getTime();
  return ageMs / (1000 * 60 * 60);
}

/**
 * Build trending clusters from recent articles
 * Groups by entity + context, scores by freshness/quality/diversity
 */
export function buildTrendingClusters(
  articles: ArticleInput[],
  seasonMode: SeasonMode = 'regular',
  maxClusters: number = 8
): TrendCluster[] {
  // Group articles by entity + context
  const clusterMap = new Map<string, {
    articles: ArticleInput[];
    contexts: Map<TrendContext, number>;
  }>();
  
  for (const article of articles) {
    // Extract players
    const players = extractPlayerNames(article.title, article.players);
    const contexts = detectContexts(article);
    
    // Create clusters for each player + context combination
    for (const player of players) {
      for (const context of contexts) {
        const key = `player:${slugify(player)}:${context}`;
        
        if (!clusterMap.has(key)) {
          clusterMap.set(key, {
            articles: [],
            contexts: new Map(),
          });
        }
        
        const cluster = clusterMap.get(key)!;
        cluster.articles.push(article);
        cluster.contexts.set(context, (cluster.contexts.get(context) || 0) + 1);
      }
    }
  }
  
  // Build TrendCluster objects with scoring
  const clusters: TrendCluster[] = [];
  
  for (const [key, data] of clusterMap.entries()) {
    // Skip single-article clusters with low quality
    if (data.articles.length === 1 && (data.articles[0].score || 0) < 60) {
      continue;
    }
    
    // Parse key: player:saquon-barkley:workload
    const [entityType, entitySlug, contextStr] = key.split(':') as [TrendEntityType, string, TrendContext];
    
    // Determine primary context (most mentioned)
    const sortedContexts = Array.from(data.contexts.entries())
      .sort((a, b) => b[1] - a[1]);
    const primaryContext = sortedContexts[0][0];
    
    // Calculate metrics
    const articleIds = data.articles.map(a => a.id);
    const sources = [...new Set(data.articles.map(a => a.source).filter(Boolean))];
    const sourceCount = sources.length;
    
    // Average quality score
    const avgQuality = data.articles.reduce((sum, a) => sum + (a.score || 50), 0) / data.articles.length;
    
    // Freshness (hours since most recent article)
    const freshnesses = data.articles.map(getArticleFreshness);
    const freshness = Math.min(...freshnesses);
    
    // Time decay
    const timeDecay = calculateTimeDecay(freshness);
    
    // Season boost
    const seasonPriority = SEASON_CONTEXT_PRIORITY[seasonMode];
    const seasonBoost = seasonPriority[primaryContext] || 1.0;
    
    // Context priority (base importance)
    const contextPriority = primaryContext === 'generic_news' ? 0.5 : 1.0;
    
    // Final score: quality * diversity * freshness * season * context
    const score = 
      (avgQuality / 100) *
      Math.log2(sourceCount + 1) * // Source diversity (log scale)
      Math.sqrt(data.articles.length) * // Article count (sqrt scale)
      timeDecay *
      seasonBoost *
      contextPriority;
    
    // Entity name (de-slugify)
    const entityName = entitySlug.split('-').map(w => 
      w.charAt(0).toUpperCase() + w.slice(1)
    ).join(' ');
    
    clusters.push({
      key,
      entityType,
      entityName,
      entitySlug,
      context: primaryContext,
      contextLabel: CONTEXT_LABELS[primaryContext],
      label: `${entityName} ${CONTEXT_LABELS[primaryContext]}`,
      articleCount: data.articles.length,
      sourceCount,
      articleIds,
      score,
      freshness,
      debug: {
        avgQuality,
        seasonBoost,
        contextPriority,
        timeDecay,
        sources: sources as string[],
      },
    });
  }
  
  // Sort by score desc, take top N
  clusters.sort((a, b) => b.score - a.score);
  
  return clusters.slice(0, maxClusters);
}

/**
 * Get current season mode based on date
 */
export function getCurrentSeasonMode(): SeasonMode {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  
  // Off-Season: Feb 1 - May 10
  if ((month === 2) || (month === 3) || (month === 4) || (month === 5 && day <= 10)) {
    return 'off-season';
  }
  
  // Preseason: July 25 - Sept 10
  if ((month === 7 && day >= 25) || (month === 8) || (month === 9 && day <= 10)) {
    return 'preseason';
  }
  
  return 'regular';
}
