"use client";

import { useState } from "react";
import type { Article } from "@/types/sources";
import BetaSection from "@/components/beta/BetaSection";
import Link from "next/link";

// Strong mock draft detector (runs BEFORE general clustering)
function isMockDraft(article: Article): boolean {
  const title = (article.title || '').toLowerCase();
  const url = (article.canonical_url || article.url || '').toLowerCase();
  
  // Normalize: remove HTML entities, normalize spaces/hyphens
  const normalizeText = (str: string) => {
    return str
      .replace(/&[a-z0-9#]+;/gi, ' ')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };
  
  const text = normalizeText(`${title} ${url}`);

  // EXCLUSIONS (very narrow - only clear false positives)
  if (/\bre-?do\b|\bredrafts?\b|draftkings?/i.test(text)) {
    return false;
  }

  // PRIMARY DETECTION (stronger patterns)
  // 1. "mock draft" or "mock drafts" (with word boundaries)
  if (/\bmock\s+drafts?\b/i.test(text)) {
    return true;
  }

  // 2. "draft" and "mock" in same text (any order)
  if (/\bmock\b/i.test(text) && /\bdraft\b/i.test(text)) {
    return true;
  }

  // 3. Specific multi-round patterns
  if (/[37]\s+round\s+mock|rounds?\s+1\s*[-?]\s*[37]|full\s+mock/i.test(text)) {
    return true;
  }

  // 4. Round 1 / First round mocks
  if (/(first|round\s+1)\s+(mock|predictions?|projections?)/i.test(text)) {
    return true;
  }

  // 5. Projected picks / pick predictions
  if (/projected\s+picks?|pick\s+predictions?/i.test(text)) {
    return true;
  }

  // 6. Mock version numbers
  if (/mock\s+[1-9]\.0|mock\s+draft\s+simulator/i.test(text)) {
    return true;
  }

  return false;
}
// Paywall detection - exclude paywalled content
const PAYWALL_DOMAINS = [
  'theathletic.com',
  'espn.com/insider',
  'si.com/vault',
  'footballoutsiders.com/premium',
];

function isPaywalled(article: Article): boolean {
  const url = (article.canonical_url || article.url || '').toLowerCase();
  return PAYWALL_DOMAINS.some(domain => url.includes(domain));
}


type DraftCluster = {
  title: string;
  subtitle: string;
  articles: Article[];
  keywords: RegExp;
};

const CLUSTERS: Omit<DraftCluster, 'articles'>[] = [
  {
    title: "Mock Drafts",
    subtitle: "Projected picks & scenarios",
    keywords: /mock\s+draft|7[-\s]?round\s+mock|3[-\s]?round\s+mock|rounds?\s+1[-\s]?7|round\s+1(?!\d)|pick\s+predictions?|team\s+predictions?|projected\s+picks?|full\s+first\s+round|mock\s+[1-9]\.0|mock\s+draft\s+simulator/i,
  },
  {
    title: "Prospect Rankings",
    subtitle: "Big boards & positional ranks",
    keywords: /big\s+board|prospect\s+rank|top\s+prospects?|position\s+rank|top\s+\d+/i,
  },
  {
    title: "Draft Buzz",
    subtitle: "News, risers, and rumors",
    keywords: /stock\s+up|stock\s+down|combine|pro\s+day|riser|faller|buzz|rumor|visit|meeting|medical/i,
  },
  {
    title: "Team Fits",
    subtitle: "Landing spots & team needs",
    keywords: /landing\s+spot|team\s+fit|best\s+fit|draft\s+need|team\s+need/i,
  },
];

function clusterDraftArticles(articles: Article[]): DraftCluster[] {
  const clusters: DraftCluster[] = CLUSTERS.map(c => ({
    ...c,
    articles: [],
  }));

  const assigned = new Set<number>();
  const mockCluster = clusters.find(c => c.title === "Mock Drafts");

  // PRIORITY PASS: Assign mock drafts FIRST using strong detector
  if (mockCluster) {
    for (const article of articles) {
      if (isMockDraft(article) && !assigned.has(article.id)) {
        mockCluster.articles.push(article);
        assigned.add(article.id);
      }
    }
  }

  // Second pass: assign remaining articles to other clusters
  for (const article of articles) {
    if (assigned.has(article.id)) continue;

    const text = `${article.title} ${article.canonical_url || article.url || ''} ${article.summary || ''}`;
    
    for (const cluster of clusters) {
      // Skip Mock Drafts (already handled) and Team Fits (disabled)
      if (cluster.title === "Mock Drafts" || cluster.title === "Team Fits") continue;

      if (cluster.keywords.test(text) && !assigned.has(article.id)) {
        cluster.articles.push(article);
        assigned.add(article.id);
        break;
      }
    }
  }

  // Unassigned articles go to Draft Buzz (catch-all)
  const buzzCluster = clusters.find(c => c.title === "Draft Buzz");
  if (buzzCluster) {
    for (const article of articles) {
      if (!assigned.has(article.id)) {
        buzzCluster.articles.push(article);
      }
    }
  }

  // Return only non-empty clusters (exclude Team Fits even if it has articles)
  return clusters.filter(c => c.articles.length > 0 && c.title !== "Team Fits");
}

export default function BetaDraftSection({ articles }: { articles: Article[] }) {
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  const toggleCluster = (clusterTitle: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(clusterTitle)) {
        next.delete(clusterTitle);
      } else {
        next.add(clusterTitle);
      }
      return next;
    });
  };

  // Filter out paywalled content
  const freeArticles = articles.filter(a => !isPaywalled(a));
  if (!freeArticles || freeArticles.length === 0) {
    return (
      <BetaSection
        title="NFL Draft"
        subtitle="Mocks, rankings, rumors, and landing spot buzz"
      >
        <p className="text-sm text-zinc-500">No draft content available.</p>
      </BetaSection>
    );
  }

  const clusters = clusterDraftArticles(freeArticles);

  // If very sparse, show simple list instead
  if (freeArticles.length < 6) {
    return (
      <BetaSection
        title="NFL Draft"
        subtitle="Mocks, rankings, rumors, and landing spot buzz"
      >
        <div className="space-y-2">
          {freeArticles.slice(0, 8).map(article => (
            <Link
              key={article.id}
              href={article.canonical_url || article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-zinc-200 bg-white p-3 transition-all hover:border-zinc-300 hover:shadow-md"
            >
              <h3 className="text-sm font-semibold text-zinc-900 line-clamp-2">
                {article.title}
              </h3>
              {article.source && (
                <p className="mt-1 text-xs text-zinc-500">{article.source}</p>
              )}
            </Link>
          ))}
        </div>
      </BetaSection>
    );
  }

  return (
    <BetaSection
      title="NFL Draft"
      subtitle="Mocks, rankings, rumors, and landing spot buzz"
    >
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        {clusters.map((cluster) => {
          const isExpanded = expandedClusters.has(cluster.title);
          const visibleArticles = isExpanded ? cluster.articles : cluster.articles.slice(0, 8);
          const hasMore = cluster.articles.length > 8;

          return (
            <div
              key={cluster.title}
              className="h-full flex flex-col rounded-xl border border-zinc-300 bg-gradient-to-br from-white to-zinc-50 p-5"
            >
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-800">
                    {cluster.title}
                  </h3>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    {cluster.articles.length}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{cluster.subtitle}</p>
              </div>
              <div className="flex-1 space-y-2">
                {visibleArticles.map((article) => (
                  <Link
                    key={article.id}
                    href={article.canonical_url || article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-md border border-zinc-100 bg-white p-2 text-sm transition-all hover:border-emerald-200 hover:shadow-sm"
                  >
                    <div className="font-medium text-zinc-900 line-clamp-2">
                      {article.title}
                    </div>
                    {article.source && (
                      <div className="mt-1 text-xs text-zinc-500">
                        {article.source}
                      </div>
                    )}
                  </Link>
                ))}
                {hasMore && (
                  <button
                    onClick={() => toggleCluster(cluster.title)}
                    className="w-full cursor-pointer pt-1 text-left text-xs font-medium text-emerald-600 transition-colors hover:text-emerald-700 hover:underline"
                  >
                    {isExpanded 
                      ? '? Show less' 
                      : `+ ${cluster.articles.length - 8} more`
                    }
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </BetaSection>
  );
}