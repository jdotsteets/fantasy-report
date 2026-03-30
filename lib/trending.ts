// lib/trending.ts
// Server-side trending intelligence for fantasy football
// Clusters related articles by entity + context with smarter filtering and scoring

export type SeasonMode = "regular" | "off-season" | "preseason";

export type TrendContext =
  | "injury"
  | "workload"
  | "depth_chart"
  | "starting_role"
  | "transaction"
  | "trade"
  | "signing"
  | "waiver"
  | "start_sit"
  | "breakout"
  | "rookie"
  | "mock_draft"
  | "landing_spot"
  | "coach_speak"
  | "dfs"
  | "ranking"
  | "generic_news";

export type TrendEntityType = "player" | "team" | "topic";

export type TrendCluster = {
  key: string;
  entityType: TrendEntityType;
  entityName: string;
  entitySlug: string;
  context: TrendContext;
  contextLabel: string;
  label: string;
  articleCount: number;
  sourceCount: number;
  articleIds: number[];
  score: number;
  freshness: number;
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

type EntityCandidate = {
  type: TrendEntityType;
  name: string;
  slug: string;
  confidence: number;
};

type ClusterAccumulator = {
  articles: ArticleInput[];
  contexts: Map<TrendContext, number>;
  entityType: TrendEntityType;
  entityName: string;
  entitySlug: string;
};

const CONTEXT_PATTERNS: Record<TrendContext, RegExp[]> = {
  injury: [
    /\b(injur(?:y|ies|ed)?|ir\b|questionable|doubtful|out for|ruled out|miss(?:es|ed|ing)?|sidelined|return(?:ing)?|recovery|rehab|limited participant)\b/i,
  ],
  workload: [
    /\b(touches?|target share|snap(?:s| count)?|usage|workload|volume|carr(?:y|ies)|targets?|involvement|opportunity share)\b/i,
  ],
  depth_chart: [
    /\b(depth chart|starter|backup|rb1|rb2|wr1|wr2|te1|rotation|pecking order|second string|first team)\b/i,
  ],
  starting_role: [
    /\b(start(?:er|ing)?|bench(?:ed|ing)?|lead back|lead role|three-down|workhorse|bellcow|named starter)\b/i,
  ],
  transaction: [
    /\b(transaction|release(?:d)?|cut|claim(?:ed)?|waive(?:d|r)?|signed? by|added? to roster|practice squad|activated)\b/i,
  ],
  trade: [
    /\b(trade(?:d)?|dealt|acquire(?:d)?|swap|package|sent to|moved to)\b/i,
  ],
  signing: [
    /\b(sign(?:ed|ing)?|contract|extension|deal|agree(?:d)? to terms|free agent|re-sign(?:ed|ing)?)\b/i,
  ],
  waiver: [
    /\b(waiver|pickup|pick-up|add|drop|stream(?:er)?|stash(?:es|ing)?|available in)\b/i,
  ],
  start_sit: [
    /\b(start\/sit|start-?sit|start(?: him)?|sit(?: him)?|must-start|must-sit|lineup|bench|who should i start)\b/i,
  ],
  breakout: [
    /\b(breakout|sleeper|emerge(?:s|d)?|rising|stock up|buy low|undervalued?)\b/i,
  ],
  rookie: [
    /\b(rookie|first-year|draft class|rookie outlook|rookie report)\b/i,
  ],
  mock_draft: [
    /\b(mock draft|draft board|big board|adp|draft strategy|best ball)\b/i,
  ],
  landing_spot: [
    /\b(landing spot|fit|scheme fit|situation|opportunity|join(?:s|ed)?|move to)\b/i,
  ],
  coach_speak: [
    /\b(coach|said|says|comment(?:s)?|hint(?:ed)?|praised?|confident|feature|plan(?:s|ned)? to use)\b/i,
  ],
  dfs: [
    /\b(dfs|draftkings|fanduel|showdown|cash game|gpp|tournament|value play)\b/i,
  ],
  ranking: [
    /\b(rank(?:ing|s)?|tier(?:s)?|top \d+|rest of season|ros|ppr|standard|dynasty|redraft)\b/i,
  ],
  generic_news: [/.*/],
};

const CONTEXT_LABELS: Record<TrendContext, string> = {
  injury: "injury update",
  workload: "workload concern",
  depth_chart: "depth chart shift",
  starting_role: "starting role",
  transaction: "transaction",
  trade: "trade buzz",
  signing: "signing impact",
  waiver: "waiver target",
  start_sit: "start/sit advice",
  breakout: "breakout buzz",
  rookie: "rookie outlook",
  mock_draft: "mock draft buzz",
  landing_spot: "landing spot analysis",
  coach_speak: "coach comments",
  dfs: "DFS play",
  ranking: "rankings update",
  generic_news: "news",
};

const SEASON_CONTEXT_PRIORITY: Record<
  SeasonMode,
  Partial<Record<TrendContext, number>>
> = {
  regular: {
    injury: 1.55,
    workload: 1.45,
    depth_chart: 1.4,
    starting_role: 1.45,
    waiver: 1.3,
    start_sit: 1.45,
    transaction: 1.25,
    trade: 1.15,
    coach_speak: 1.1,
    dfs: 1.05,
    ranking: 0.95,
    generic_news: 0.55,
  },
  "off-season": {
    signing: 1.5,
    trade: 1.5,
    mock_draft: 1.45,
    landing_spot: 1.4,
    rookie: 1.3,
    depth_chart: 1.15,
    ranking: 1.0,
    generic_news: 0.55,
  },
  preseason: {
    starting_role: 1.5,
    depth_chart: 1.45,
    injury: 1.3,
    rookie: 1.3,
    coach_speak: 1.2,
    breakout: 1.2,
    workload: 1.2,
    ranking: 0.95,
    generic_news: 0.55,
  },
};

const TEAM_NAMES = [
  "Arizona Cardinals",
  "Atlanta Falcons",
  "Baltimore Ravens",
  "Buffalo Bills",
  "Carolina Panthers",
  "Chicago Bears",
  "Cincinnati Bengals",
  "Cleveland Browns",
  "Dallas Cowboys",
  "Denver Broncos",
  "Detroit Lions",
  "Green Bay Packers",
  "Houston Texans",
  "Indianapolis Colts",
  "Jacksonville Jaguars",
  "Kansas City Chiefs",
  "Las Vegas Raiders",
  "Los Angeles Chargers",
  "Los Angeles Rams",
  "Miami Dolphins",
  "Minnesota Vikings",
  "New England Patriots",
  "New Orleans Saints",
  "New York Giants",
  "New York Jets",
  "Philadelphia Eagles",
  "Pittsburgh Steelers",
  "San Francisco 49ers",
  "Seattle Seahawks",
  "Tampa Bay Buccaneers",
  "Tennessee Titans",
  "Washington Commanders",
];

const LOW_SIGNAL_TITLE_PATTERNS: RegExp[] = [
  /\b(radio|broadcast|coverage|station|podcast|show|listen live)\b/i,
  /\b(mlb|nba|nhl|ncaa basketball|march madness|fantasy baseball|fantasy basketball|fantasy hockey)\b/i,
  /\b(ticket(?:s)?|merch|shop|odds|sportsbook|betting picks?)\b/i,
];

const STOP_PHRASES = new Set<string>([
  "Fantasy Football",
  "New York",
  "New England",
  "New Orleans",
  "Los Angeles",
  "San Francisco",
  "Green Bay",
  "Kansas City",
  "Las Vegas",
  "Tampa Bay",
  "Free Agency",
  "Mock Draft",
  "Draft Kings",
  "Fan Duel",
  "Yahoo Sports",
  "Pro Football",
  "Fantasy Report",
  "The Athletic",
  "Roto World",
  "Fantasy Pros",
  "Running Backs",
  "Wide Receivers",
  "Tight Ends",
  "Rest Of",
  "Of Season",
]);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function isLowSignalArticle(article: ArticleInput): boolean {
  const hay = `${article.title} ${article.url} ${article.domain ?? ""}`;
  return LOW_SIGNAL_TITLE_PATTERNS.some((pattern) => pattern.test(hay));
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractTeamNames(title: string): string[] {
  const found: string[] = [];
  for (const team of TEAM_NAMES) {
    if (new RegExp(`\\b${team.replace(/\s+/g, "\\s+")}\\b`, "i").test(title)) {
      found.push(team);
    }
  }
  return found;
}

function extractPlayerNames(
  title: string,
  playersArray: readonly string[] | string[] | null | [] | undefined,
): string[] {
  const found = new Set<string>();

  if (playersArray && Array.isArray(playersArray) && playersArray.length > 0) {
    for (const player of playersArray) {
      const cleaned = player.trim();
      if (cleaned) found.add(cleaned);
    }
  }

  const twoWordNamePattern = /\b([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15})\b/g;
  let match: RegExpExecArray | null = twoWordNamePattern.exec(title);

  while (match) {
    const candidate = match[1].trim();
    const words = candidate.split(" ");
    const validLength = words.every((word) => word.length >= 2 && word.length <= 12);

    if (!STOP_PHRASES.has(candidate) && validLength) {
      found.add(candidate);
    }

    match = twoWordNamePattern.exec(title);
  }

  return Array.from(found);
}

function getEntityCandidates(article: ArticleInput): EntityCandidate[] {
  const title = normalizeTitle(article.title);
  const players = extractPlayerNames(title, article.players);
  const teams = extractTeamNames(title);

  const candidates: EntityCandidate[] = [];

  for (const player of players) {
    candidates.push({
      type: "player",
      name: player,
      slug: slugify(player),
      confidence: 1.0,
    });
  }

  if (players.length === 0) {
    for (const team of teams) {
      candidates.push({
        type: "team",
        name: team,
        slug: slugify(team),
        confidence: 0.72,
      });
    }
  }

  if (players.length === 0 && teams.length === 0) {
    const topicSource =
      article.primary_topic ??
      article.secondary_topic ??
      (Array.isArray(article.topics) && article.topics.length > 0 ? article.topics[0] : null) ??
      "news";

    const topicLabel = titleCaseFromSlug(topicSource.replace(/_/g, "-"));
    candidates.push({
      type: "topic",
      name: topicLabel,
      slug: slugify(topicLabel),
      confidence: 0.45,
    });
  }

  return candidates.slice(0, 3);
}

function detectContexts(article: ArticleInput): TrendContext[] {
  const text =
    `${article.title} ${article.primary_topic ?? ""} ${article.secondary_topic ?? ""} ${
      Array.isArray(article.topics) ? article.topics.join(" ") : ""
    }`.toLowerCase();

  const contexts: TrendContext[] = [];

  for (const [context, patterns] of Object.entries(CONTEXT_PATTERNS) as Array<
    [TrendContext, RegExp[]]
  >) {
    if (patterns.some((pattern) => pattern.test(text))) {
      contexts.push(context);
    }
  }

  if (contexts.length > 1 && contexts.includes("generic_news")) {
    return contexts.filter((context) => context !== "generic_news");
  }

  return contexts.length > 0 ? contexts : ["generic_news"];
}

function choosePrimaryContext(contexts: TrendContext[]): TrendContext[] {
  const priority: TrendContext[] = [
    "injury",
    "starting_role",
    "workload",
    "depth_chart",
    "transaction",
    "trade",
    "signing",
    "waiver",
    "start_sit",
    "breakout",
    "rookie",
    "mock_draft",
    "landing_spot",
    "coach_speak",
    "dfs",
    "ranking",
    "generic_news",
  ];

  const sorted = [...new Set(contexts)].sort(
    (a, b) => priority.indexOf(a) - priority.indexOf(b),
  );

  return sorted.slice(0, 2);
}

function calculateTimeDecay(hoursOld: number): number {
  return Math.pow(0.5, hoursOld / 12);
}

function getArticleFreshness(article: ArticleInput): number {
  const now = Date.now();
  const articleDate = article.published_at ?? article.discovered_at;
  if (!articleDate) return 999;

  const ageMs = now - new Date(articleDate).getTime();
  return ageMs / (1000 * 60 * 60);
}

function getArticleQuality(article: ArticleInput): number {
  const explicit = article.score ?? null;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.min(explicit, 100));
  }

  const contexts = detectContexts(article);
  const freshness = getArticleFreshness(article);

  let quality = 55;

  if (contexts.includes("injury")) quality += 12;
  if (contexts.includes("starting_role")) quality += 10;
  if (contexts.includes("workload")) quality += 8;
  if (contexts.includes("transaction") || contexts.includes("trade") || contexts.includes("signing")) {
    quality += 8;
  }
  if (contexts.includes("mock_draft") || contexts.includes("ranking")) {
    quality -= 4;
  }
  if (contexts.includes("generic_news")) {
    quality -= 8;
  }

  if (freshness <= 3) quality += 8;
  else if (freshness <= 12) quality += 4;
  else if (freshness > 36) quality -= 8;

  if (isLowSignalArticle(article)) {
    quality -= 20;
  }

  return Math.max(1, Math.min(quality, 100));
}

function dedupeArticles(rows: ArticleInput[]): ArticleInput[] {
  const seen = new Set<string>();
  const out: ArticleInput[] = [];

  for (const row of rows) {
    const key = `${row.id}:${normalizeTitle(row.title).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

export function buildTrendingClusters(
  articles: ArticleInput[],
  seasonMode: SeasonMode = "regular",
  maxClusters: number = 8,
): TrendCluster[] {
  const clusterMap = new Map<string, ClusterAccumulator>();

  const maxFreshness = seasonMode === 'off-season' ? 96 : 48;  // 4 days offseason, 2 days regular
  
  const candidates = dedupeArticles(articles)
    .filter((article) => !isLowSignalArticle(article))
    .filter((article) => getArticleFreshness(article) <= maxFreshness)
    .slice(0, 500);

  for (const article of candidates) {
    const entities = getEntityCandidates(article);
    const contexts = choosePrimaryContext(detectContexts(article));

    for (const entity of entities) {
      for (const context of contexts) {
        if (entity.type === "topic" && context === "generic_news") {
          continue;
        }

        const key = `${entity.type}:${entity.slug}:${context}`;

        if (!clusterMap.has(key)) {
          clusterMap.set(key, {
            articles: [],
            contexts: new Map<TrendContext, number>(),
            entityType: entity.type,
            entityName: entity.name,
            entitySlug: entity.slug,
          });
        }

        const cluster = clusterMap.get(key);
        if (!cluster) continue;

        cluster.articles.push(article);
        cluster.contexts.set(context, (cluster.contexts.get(context) ?? 0) + 1);
      }
    }
  }

  const clusters: TrendCluster[] = [];

  for (const [key, data] of clusterMap.entries()) {
    const uniqueArticles = dedupeArticles(data.articles);

    if (uniqueArticles.length === 0) continue;

    const sortedContexts = Array.from(data.contexts.entries()).sort((a, b) => b[1] - a[1]);
    const primaryContext = sortedContexts[0]?.[0] ?? "generic_news";

    const articleIds = uniqueArticles.map((article) => article.id);
    const sources = Array.from(
      new Set(
        uniqueArticles
          .map((article) => article.source)
          .filter((source): source is string => Boolean(source && source.trim())),
      ),
    );
    const sourceCount = sources.length;

    const avgQuality =
      uniqueArticles.reduce((sum, article) => sum + getArticleQuality(article), 0) /
      uniqueArticles.length;

    const freshness = Math.min(...uniqueArticles.map(getArticleFreshness));
    const timeDecay = calculateTimeDecay(freshness);
    const seasonBoost = SEASON_CONTEXT_PRIORITY[seasonMode][primaryContext] ?? 1.0;
    const contextPriority =
      primaryContext === "generic_news"
        ? 0.45
        : primaryContext === "ranking" || primaryContext === "mock_draft"
          ? 0.85
          : 1.0;

    const multiSourceBoost = sourceCount >= 2 ? Math.log2(sourceCount + 1) : 0.7;
    const articleVolumeBoost = Math.sqrt(uniqueArticles.length);

    const score =
      (avgQuality / 100) *
      multiSourceBoost *
      articleVolumeBoost *
      timeDecay *
      seasonBoost *
      contextPriority;

    // Season-aware minimum signal thresholds
    const minArticles = seasonMode === 'off-season' ? 1 : 2;
    const minSources = seasonMode === 'off-season' ? 1 : 2;
    const minQuality = seasonMode === 'off-season' ? 60 : 72;

    const isWeakGeneric =
      primaryContext === "generic_news" &&
      (uniqueArticles.length < minArticles || sourceCount < minSources);

    const belowMinimumSignal =
      uniqueArticles.length < minArticles &&
      avgQuality < minQuality &&
      sourceCount < minSources;

    if (isWeakGeneric || belowMinimumSignal) {
      continue;
    }

    const entityName = data.entityName;
    const label =
      data.entityType === "topic"
        ? `${CONTEXT_LABELS[primaryContext]}`
        : `${entityName} ${CONTEXT_LABELS[primaryContext]}`;

    clusters.push({
      key,
      entityType: data.entityType,
      entityName,
      entitySlug: data.entitySlug,
      context: primaryContext,
      contextLabel: CONTEXT_LABELS[primaryContext],
      label,
      articleCount: uniqueArticles.length,
      sourceCount,
      articleIds,
      score,
      freshness,
      debug: {
        avgQuality,
        seasonBoost,
        contextPriority,
        timeDecay,
        sources,
      },
    });
  }

  clusters.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.freshness !== b.freshness) return a.freshness - b.freshness;
    return b.articleCount - a.articleCount;
  });

  let finalClusters = clusters.slice(0, maxClusters);
  
  // FALLBACK LAYER 1: If too few clusters, add single high-quality recent stories
  if (finalClusters.length < 3 && candidates.length > 0) {
    const existingIds = new Set(finalClusters.flatMap(c => c.articleIds));
    const remainingArticles = candidates.filter(a => !existingIds.has(a.id));
    
    const minQualityFallback = seasonMode === 'off-season' ? 65 : 75;
    const maxFreshnessFallback = seasonMode === 'off-season' ? 48 : 24;
    
    const singleStoryClusters = remainingArticles
      .filter(a => getArticleQuality(a) >= minQualityFallback)
      .filter(a => getArticleFreshness(a) <= maxFreshnessFallback)
      .slice(0, 5)
      .map(article => createSingleArticleCluster(article, seasonMode));
    
    finalClusters = [...finalClusters, ...singleStoryClusters].slice(0, maxClusters);
  }

  // FALLBACK LAYER 2: If still empty, create generic "Top Story" clusters
  if (finalClusters.length === 0 && candidates.length > 0) {
    const topStories = candidates
      .slice(0, 5)
      .map(article => createTopStoryCluster(article, seasonMode));
    
    finalClusters = topStories;
  }

  console.log('📈 TRENDING AFTER FALLBACK:', {
    finalClusterCount: finalClusters.length,
    clusterLabels: finalClusters.map(c => c.label),
    clusterTypes: finalClusters.map(c => c.entityType)
  });
  
  return finalClusters;
}


// Helper: Create a single-article cluster
function createSingleArticleCluster(article: ArticleInput, seasonMode: SeasonMode): TrendCluster {
  const contexts = detectContexts(article);
  const primaryContext = choosePrimaryContext(contexts)[0] || 'generic_news';
  const freshness = getArticleFreshness(article);
  const quality = getArticleQuality(article);
  
  const entities = getEntityCandidates(article);
  const entity = entities[0] || { type: 'topic', name: 'NFL', slug: 'nfl', confidence: 0.5 };
  
  const timeDecay = calculateTimeDecay(freshness);
  const seasonBoost = SEASON_CONTEXT_PRIORITY[seasonMode][primaryContext] ?? 1.0;
  const score = (quality / 100) * timeDecay * seasonBoost;
  
  return {
    key: `single:${article.id}:${primaryContext}`,
    entityType: entity.type,
    entityName: entity.name,
    entitySlug: entity.slug,
    context: primaryContext,
    contextLabel: CONTEXT_LABELS[primaryContext],
    label: entity.type === 'topic' 
      ? `${CONTEXT_LABELS[primaryContext]}`
      : `${entity.name} ${CONTEXT_LABELS[primaryContext]}`,
    articleCount: 1,
    sourceCount: 1,
    articleIds: [article.id],
    score,
    freshness,
    debug: {
      avgQuality: quality,
      seasonBoost,
      contextPriority: 1.0,
      timeDecay,
      sources: [article.source].filter((s): s is string => Boolean(s)),
    },
  };
}

// Helper: Create a generic "Top Story" cluster
function createTopStoryCluster(article: ArticleInput, seasonMode: SeasonMode): TrendCluster {
  const freshness = getArticleFreshness(article);
  const quality = getArticleQuality(article);
  const timeDecay = calculateTimeDecay(freshness);
  const score = (quality / 100) * timeDecay * 0.8;  // Lower priority than real clusters
  
  return {
    key: `top-story:${article.id}`,
    entityType: 'topic',
    entityName: 'NFL',
    entitySlug: 'nfl',
    context: 'generic_news',
    contextLabel: 'Top Story',
    label: 'Top Story',
    articleCount: 1,
    sourceCount: 1,
    articleIds: [article.id],
    score,
    freshness,
    debug: {
      avgQuality: quality,
      seasonBoost: 1.0,
      contextPriority: 0.8,
      timeDecay,
      sources: [article.source].filter((s): s is string => Boolean(s)),
    },
  };
}

export function getCurrentSeasonMode(): SeasonMode {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  if (month === 2 || month === 3 || month === 4 || (month === 5 && day <= 10)) {
    return "off-season";
  }

  if ((month === 7 && day >= 25) || month === 8 || (month === 9 && day <= 10)) {
    return "preseason";
  }

  return "regular";
}