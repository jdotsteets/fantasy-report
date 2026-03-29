"use client";

import type { TrendCluster } from "@/lib/trending";
import BetaSection from "@/components/beta/BetaSection";

type BetaTrendingProps = {
  clusters: TrendCluster[];
};

export default function BetaTrending({ clusters }: BetaTrendingProps) {
  if (!clusters || clusters.length === 0) {
    return (
      <BetaSection
        title="🔥 Trending Now"
        subtitle="Hot players and storylines from the last 48 hours"
      >
        <p className="text-sm text-zinc-500">No trending players yet.</p>
      </BetaSection>
    );
  }

  return (
    <BetaSection
      title="🔥 Trending Now"
      subtitle="Hot players and storylines from the last 48 hours"
    >
      <div className="space-y-2">
        {clusters.map((cluster) => (
          <button
            key={cluster.key}
            onClick={() => {
              // Scroll to top and show articles about this player
              window.scrollTo({ top: 0, behavior: 'smooth' });
              // Set player name in search box for visual feedback
              const searchBox = document.querySelector('input[type="search"]') as HTMLInputElement;
              if (searchBox) {
                searchBox.value = cluster.entityName;
                searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                searchBox.focus();
              }
            }}
            className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-2 text-left transition-all hover:border-orange-400 hover:shadow-md"
            title={`${cluster.articleCount} article${cluster.articleCount > 1 ? 's' : ''} from ${cluster.sourceCount} source${cluster.sourceCount > 1 ? 's' : ''}`}
          >
            <div className="flex-1">
              <span className="text-sm font-semibold text-zinc-900">
                {cluster.entityName}
              </span>
              <span className="ml-2 text-sm text-zinc-600">
                {cluster.contextLabel}
              </span>
            </div>
            <div className="ml-3 flex items-center gap-2">
              {cluster.sourceCount > 1 && (
                <span 
                  className="text-xs font-medium text-emerald-600"
                  title={`${cluster.sourceCount} sources: ${cluster.debug.sources.join(', ')}`}
                >
                  {cluster.sourceCount} sources
                </span>
              )}
              <span className="text-xs font-medium text-orange-600">
                {cluster.articleCount}
              </span>
            </div>
          </button>
        ))}
      </div>
    </BetaSection>
  );
}
