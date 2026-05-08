"use client";

import { useState } from "react";
import Link from "next/link";
import type { Article } from "@/types/sources";
import BetaSection from "@/components/beta/BetaSection";

type TrendCluster = {
  key: string;
  label: string;
  count: number;
  articles: Article[];
  type: "player" | "team" | "storyline";
};

// Generic terms to exclude from trending
const GENERIC_BLOCKLIST = new Set([
  "news", "advice", "rankings", "injuries", "injury", "dfs", "nfl", "fantasy",
  "football", "waiver", "wire", "start", "sit", "week", "season", "game",
  "analysis", "preview", "recap", "report", "update", "fantasy football",
  "nfl news", "latest", "breaking", "fantasy advice", "fantasy rankings",
  "espn", "yahoo", "cbs", "nfl.com", "fantasypros", "the athletic", "pff",
  "pro football focus", "rotoworld", "rotoballer", "fantasy football today",
  "mock draft", "draft guide", "best ball", "dynasty", "redraft", "ppr",
]);

// Storyline phrases to detect (only used for entity context, not standalone trends)
const STORYLINE_PATTERNS = [
  { pattern: /\b(contract|extension|deal|agree|terms|signing)\b/i, label: "contract talks" },
  { pattern: /\b(depth\s+chart|depth|starter|starting|role)\b/i, label: "depth chart" },
  { pattern: /\b(backfield|rb\s+room|running\s+back\s+situation)\b/i, label: "backfield" },
  { pattern: /\b(injury|hurt|status|return|week-to-week|IR|questionable|doubtful)\b/i, label: "injury update" },
  { pattern: /\b(sleeper|breakout|emerge|rising|stock\s+up)\b/i, label: "breakout buzz" },
  { pattern: /\b(bust|fade|avoid|overhyped|stock\s+down)\b/i, label: "risk" },
  { pattern: /\b(adp|average\s+draft\s+position|draft\s+value)\b/i, label: "ADP movement" },
  { pattern: /\b(trade|traded|deal|acquire|swap)\b/i, label: "trade buzz" },
  { pattern: /\b(rookie|draft\s+pick|landing\s+spot)\b/i, label: "rookie outlook" },
  { pattern: /\b(waiver|add|pickup|target|claim)\b/i, label: "waiver target" },
  { pattern: /\b(wr1|wr2|rb1|rb2|te1|qb1|top\s+\d+)\b/i, label: "ranking tier" },
];

// NFL teams (abbreviated)
const NFL_TEAMS = new Set([
  "Cardinals", "Falcons", "Ravens", "Bills", "Panthers", "Bears", "Bengals", "Browns",
  "Cowboys", "Broncos", "Lions", "Packers", "Texans", "Colts", "Jaguars", "Chiefs",
  "Raiders", "Chargers", "Rams", "Dolphins", "Vikings", "Patriots", "Saints", "Giants",
  "Jets", "Eagles", "Steelers", "49ers", "Seahawks", "Buccaneers", "Titans", "Commanders",
  "Arizona", "Atlanta", "Baltimore", "Buffalo", "Carolina", "Chicago", "Cincinnati", "Cleveland",
  "Dallas", "Denver", "Detroit", "Green Bay", "Houston", "Indianapolis", "Jacksonville", "Kansas City",
  "Las Vegas", "Los Angeles", "Miami", "Minnesota", "New England", "New Orleans", "New York",
  "Philadelphia", "Pittsburgh", "San Francisco", "Seattle", "Tampa Bay", "Tennessee", "Washington",
]);

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#8217;/g, "'");
}

function extractNames(text: string): string[] {
  const names: string[] = [];
  
  // Two-word name pattern: uppercase word followed by uppercase word
  // Handles: "Patrick Mahomes", "Josh Allen", "Marvin Harrison Jr"
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z']+){1,2}(?:\s+(?:Jr|Sr|III|II|IV)\.?)?)\b/g;
  
  let match;
  while ((match = namePattern.exec(text)) !== null) {
    const candidate = match[1].trim();
    const lower = candidate.toLowerCase();
    
    // Skip generic terms
    if (GENERIC_BLOCKLIST.has(lower)) continue;
    
    // Skip publisher names (usually appear at start of title or in source)
    if (candidate.length < 5) continue;
    
    // Skip if it's just a team name alone (we handle teams separately)
    if (NFL_TEAMS.has(candidate.split(" ")[0])) continue;
    
    names.push(candidate);
  }
  
  return names;
}

function extractTeamStorylines(text: string): string[] {
  const storylines: string[] = [];
  
  for (const team of NFL_TEAMS) {
    const teamPattern = new RegExp(`\\b${team}\\b`, "i");
    if (!teamPattern.test(text)) continue;
    
    // Check for specific team storylines
    if (/\b(backfield|rb|running\s+back)\b/i.test(text)) {
      storylines.push(`${team} backfield`);
    }
    if (/\b(wr|receiver|depth\s+chart)\b/i.test(text)) {
      storylines.push(`${team} WR depth`);
    }
    if (/\b(qb|quarterback)\b/i.test(text)) {
      storylines.push(`${team} QB situation`);
    }
    if (/\b(draft|rookie|pick)\b/i.test(text)) {
      storylines.push(`${team} draft`);
    }
  }
  
  return storylines;
}

function buildTrendClusters(articles: Article[]): TrendCluster[] {
  const entityMap = new Map<string, Article[]>();
  const teamMap = new Map<string, Article[]>();
  
  for (const article of articles) {
    const text = `${article.title ?? ""} ${article.summary ?? ""}`;
    
    // Extract player/coach names
    const names = extractNames(text);
    for (const name of names) {
      const existing = entityMap.get(name) ?? [];
      existing.push(article);
      entityMap.set(name, existing);
    }
    
    // Extract team storylines
    const teamStorylines = extractTeamStorylines(text);
    for (const storyline of teamStorylines) {
      const existing = teamMap.get(storyline) ?? [];
      existing.push(article);
      teamMap.set(storyline, existing);
    }
  }
  
  const clusters: TrendCluster[] = [];
  
  // Add player/entity clusters (minimum 2 articles)
  for (const [entity, articles] of entityMap.entries()) {
    if (articles.length >= 2) {
      // Determine storyline context
      const text = articles.map(a => `${a.title ?? ""} ${a.summary ?? ""}`).join(" ");
      let context = "news";
      
      if (/\b(injury|hurt|status|return)\b/i.test(text)) {
        context = "injury update";
      } else if (/\b(contract|extension|deal)\b/i.test(text)) {
        context = "contract talks";
      } else if (/\b(trade|traded|acquire)\b/i.test(text)) {
        context = "trade buzz";
      } else if (/\b(sleeper|breakout|emerge)\b/i.test(text)) {
        context = "breakout buzz";
      } else if (/\b(ranking|tier|adp)\b/i.test(text)) {
        context = "outlook";
      } else if (/\b(rookie|draft)\b/i.test(text)) {
        context = "rookie outlook";
      }
      
      clusters.push({
        key: `player:${entity}`,
        label: `${entity} ${context}`,
        count: articles.length,
        articles: articles.slice(0, 5),
        type: "player",
      });
    }
  }
  
  // Add team storyline clusters (minimum 2 articles)
  for (const [storyline, articles] of teamMap.entries()) {
    if (articles.length >= 2) {
      clusters.push({
        key: `team:${storyline}`,
        label: storyline,
        count: articles.length,
        articles: articles.slice(0, 5),
        type: "team",
      });
    }
  }
  
  // NO standalone generic storyline clusters - only entity-specific ones above
  
  // Score and sort clusters
  const now = Date.now();
  const scored = clusters.map((cluster) => {
    // Calculate recency score (0-1, favoring articles from last 24h)
    const avgAge = cluster.articles.reduce((sum, a) => {
      const age = now - new Date(a.published_at ?? a.discovered_at ?? 0).getTime();
      return sum + age;
    }, 0) / cluster.articles.length;
    
    const ageHours = avgAge / (1000 * 60 * 60);
    const recencyScore = Math.max(0, 1 - ageHours / 48); // decay over 48h
    
    // Calculate source diversity (unique sources)
    const uniqueSources = new Set(cluster.articles.map(a => a.source)).size;
    const diversityScore = Math.min(1, uniqueSources / 3); // max at 3+ sources
    
    // Calculate volume score
    const volumeScore = Math.min(1, cluster.count / 5); // max at 5+ articles
    
    // Weighted final score
    const finalScore = 
      volumeScore * 0.5 +      // 50% weight on volume
      recencyScore * 0.3 +     // 30% weight on recency
      diversityScore * 0.2;    // 20% weight on source diversity
    
    return { ...cluster, score: finalScore };
  });
  
  // Sort by score and return top 6
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function BetaTrending({ articles }: { articles: Article[] }) {
  const [expandedTrend, setExpandedTrend] = useState<string | null>(null);
  const trends = buildTrendClusters(articles);

  const toggleTrend = (key: string) => {
    setExpandedTrend((prev) => (prev === key ? null : key));
  };

  return (
    <BetaSection
      title="Trending now"
      subtitle="Hot players and storylines across the last 48 hours"
    >
      <div className="grid gap-2">
        {trends.length === 0 ? (
          <p className="text-sm text-zinc-500">No trending signals yet.</p>
        ) : (
          trends.map((trend) => {
            const isExpanded = expandedTrend === trend.key;
            const hasMore = trend.count > trend.articles.length;
            
            return (
              <div key={trend.key} className="space-y-2">
                <button
                  onClick={() => toggleTrend(trend.key)}
                  className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50"
                  aria-expanded={isExpanded}
                >
                  <span className="text-sm font-semibold text-zinc-800">
                    {decodeHtmlEntities(trend.label)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      {trend.count} {trend.count === 1 ? "hit" : "hits"}
                    </span>
                    <svg
                      className={`h-4 w-4 text-zinc-600 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="space-y-1.5 rounded-lg border border-zinc-100 bg-white p-3">
                    {trend.articles.map((article) => (
                      <div
                        key={article.id}
                        className="flex items-start justify-between gap-2 border-b border-zinc-100 pb-2 last:border-b-0 last:pb-0"
                      >
                        <div className="min-w-0 flex-1">
                          <Link
                            href={article.canonical_url ?? article.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block text-sm font-medium leading-snug text-zinc-900 hover:text-emerald-700"
                          >
                            {decodeHtmlEntities(article.title ?? "")}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                            <span className="font-medium">{article.source}</span>
                            {article.published_at && (
                              <>
                                <span>•</span>
                                <span>{formatDate(article.published_at)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <Link
                          href={article.canonical_url ?? article.url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-xs font-semibold uppercase tracking-wide text-emerald-700 hover:text-emerald-800"
                        >
                          Read
                        </Link>
                      </div>
                    ))}
                    {hasMore && (
                      <p className="pt-1 text-center text-xs text-zinc-500">
                        +{trend.count - trend.articles.length} more article{trend.count - trend.articles.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </BetaSection>
  );
}
