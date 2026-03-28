"use client";

import type { Article } from "@/types/sources";
import BetaSection from "@/components/beta/BetaSection";
import Link from "next/link";

type DraftCluster = {
  title: string;
  articles: Article[];
  keywords: RegExp;
};

const CLUSTERS: Omit<DraftCluster, 'articles'>[] = [
  {
    title: "Mock Drafts",
    keywords: /mocks+draft|first.?round|7.?rounds+mock|fulls+mock/i,
  },
  {
    title: "Prospect Rankings",
    keywords: /bigs+board|prospects+rank|tops+prospects?|positions+rank|tops+d+/i,
  },
  {
    title: "Draft Buzz",
    keywords: /stocks+up|stocks+down|combine|pros+day|riser|faller|buzz|rumor|visit|meeting|medical/i,
  },
  {
    title: "Team Fits",
    keywords: /landings+spot|teams+fit|bests+fit|drafts+need|teams+need/i,
  },
];

function clusterDraftArticles(articles: Article[]): DraftCluster[] {
  const clusters: DraftCluster[] = CLUSTERS.map(c => ({
    ...c,
    articles: [],
  }));

  const assigned = new Set<number>();

  // First pass: assign to best matching cluster
  for (const article of articles) {
    const text = `${article.title} ${article.summary || ''}`;
    
    for (const cluster of clusters) {
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

  // Return only non-empty clusters
  return clusters.filter(c => c.articles.length > 0);
}

export default function BetaDraftSection({ articles }: { articles: Article[] }) {
  if (!articles || articles.length === 0) {
    return (
      <BetaSection
        title="NFL Draft"
        subtitle="Mocks, rankings, rumors, and landing spot buzz"
      >
        <p className="text-sm text-zinc-500">No draft content available.</p>
      </BetaSection>
    );
  }

  const clusters = clusterDraftArticles(articles);

  // If very sparse, show simple list instead
  if (articles.length < 6) {
    return (
      <BetaSection
        title="NFL Draft"
        subtitle="Mocks, rankings, rumors, and landing spot buzz"
      >
        <div className="space-y-2">
          {articles.slice(0, 8).map(article => (
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
      <div className="grid gap-4 md:grid-cols-2">
        {clusters.map((cluster) => (
          <div
            key={cluster.title}
            className="rounded-xl border border-zinc-200 bg-gradient-to-br from-white to-zinc-50 p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-700">
                {cluster.title}
              </h3>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                {cluster.articles.length}
              </span>
            </div>
            <div className="space-y-2">
              {cluster.articles.slice(0, 5).map((article) => (
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
              {cluster.articles.length > 5 && (
                <div className="pt-1 text-xs font-medium text-zinc-500">
                  + {cluster.articles.length - 5} more
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </BetaSection>
  );
}
