"use client";

import { useState } from "react";
import type { Article } from "@/types/sources";
import BetaSection from "@/components/beta/BetaSection";
import Link from "next/link";

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

export default function BetaDraftSection({ mockDrafts, draftBuzz }: { mockDrafts: Article[], draftBuzz: Article[] }) {
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  const toggleCluster = (clusterTitle: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(clusterTitle)) {
        next.delete(clusterTitle);
      } else {
        next.add(clusterTitle);
      }
      return next;
    });
  };

  const freeMockDrafts = mockDrafts.filter(a => !isPaywalled(a));
  const freeDraftBuzz = draftBuzz.filter(a => !isPaywalled(a));
  const allArticles = [...freeMockDrafts, ...freeDraftBuzz];

  if (allArticles.length === 0) {
    return (
      <BetaSection
        title="NFL Draft"
        subtitle="Mocks, rankings, rumors, and landing spot buzz"
      >
        <p className="text-sm text-zinc-500">No recent draft content available.</p>
      </BetaSection>
    );
  }

  const mockDraftCluster = {
    title: "Mock Drafts",
    subtitle: "Expert predictions and team-by-team projections",
    articles: freeMockDrafts
  };

  const draftBuzzCluster = {
    title: "Draft Buzz",
    subtitle: "News, risers, and rumors",
    articles: freeDraftBuzz
  };

  const clusters = [mockDraftCluster, draftBuzzCluster].filter(c => c.articles.length > 0);

  if (allArticles.length < 6) {
    return (
      <BetaSection
        title="NFL Draft"
        subtitle="Mocks, rankings, rumors, and landing spot buzz"
      >
        <div className="space-y-2">
          {allArticles.slice(0, 8).map(article => (
            <Link
              key={article.id}
              href={article.canonical_url || article.url}
              className="block rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-900 hover:bg-zinc-50"
            >
              <h3 className="text-sm font-medium text-zinc-900">{article.title}</h3>
              {article.summary && (
                <p className="mt-1 text-xs text-zinc-600 line-clamp-2">{article.summary}</p>
              )}
              <p className="mt-2 text-xs text-zinc-500">{article.provider_name || "Source"}</p>
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
            <div key={cluster.title} className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-5">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">{cluster.title}</h3>
                <p className="mt-1 text-xs text-zinc-500">{cluster.subtitle}</p>
              </div>
              <div className="flex-1 space-y-2">
                {visibleArticles.map((article) => (
                  <Link
                    key={article.id}
                    href={article.canonical_url || article.url}
                    className="block rounded-lg border border-zinc-200 p-3 transition hover:border-zinc-900 hover:bg-zinc-50"
                  >
                    <h4 className="text-sm font-medium text-zinc-900">{article.title}</h4>
                    {article.summary && (
                      <p className="mt-1 text-xs text-zinc-600 line-clamp-2">{article.summary}</p>
                    )}
                    <p className="mt-2 text-xs text-zinc-500">{article.provider_name || "Source"}</p>
                  </Link>
                ))}
              </div>
              {hasMore && (
                <button
                  onClick={() => toggleCluster(cluster.title)}
                  className="text-xs font-medium text-zinc-700 hover:text-zinc-900 transition"
                >
                  {isExpanded ? 'Show less' : `+${cluster.articles.length - 8} more articles`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </BetaSection>
  );
}