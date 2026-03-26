import type { Article } from "@/types/sources";
import BetaSection from "@/components/beta/BetaSection";

// Extract player names from titles (simple regex approach)
function extractPlayers(articles: Article[]): Map<string, number> {
  const playerMentions = new Map<string, number>();
  
  // Common player name patterns (First Last, or just Last name)
  articles.forEach(article => {
    const title = article.title || "";
    
    // Look for capitalized names (likely player names)
    // Match patterns like "Patrick Mahomes" or "Mahomes"
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    const matches = title.match(namePattern);
    
    if (matches) {
      matches.forEach(name => {
        // Filter out common non-player words
        const skip = ["The", "Fantasy", "Week", "NFL", "Report", "News", "Update", "Best", "Worst", "Top"];
        if (!skip.includes(name)) {
          playerMentions.set(name, (playerMentions.get(name) || 0) + 1);
        }
      });
    }
  });
  
  return playerMentions;
}

function collectTopics(articles: Article[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of articles) {
    const add = (t: string | null | undefined) => {
      if (!t) return;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    };
    add(a.primary_topic ?? undefined);
    add(a.secondary_topic ?? undefined);
    if (Array.isArray(a.topics)) {
      a.topics.forEach((t) => typeof t === "string" && add(t));
    }
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function formatLabel(label: string) {
  switch (label) {
    case "waiver-wire":
      return "Waiver Wire";
    case "start-sit":
      return "Start/Sit";
    case "dfs":
      return "DFS";
    case "injury":
      return "Injuries";
    case "rankings":
      return "Rankings";
    case "advice":
      return "Advice";
    default:
      return label.replace(/\b\w/g, (m) => m.toUpperCase());
  }
}

export default function BetaTrending({ articles }: { articles: Article[] }) {
  const topics = collectTopics(articles);
  const playerMentions = extractPlayers(articles);
  
  // Top 5 trending players
  const trendingPlayers = Array.from(playerMentions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([_, count]) => count >= 2); // Only show if mentioned 2+ times

  return (
    <BetaSection
      title="Trending topics"
      subtitle="Most-covered themes across the last 48 hours"
    >
      <div className="space-y-4">
        {/* Trending Topics */}
        <div className="grid gap-2">
          {topics.length === 0 ? (
            <p className="text-sm text-zinc-500">No trending signals yet.</p>
          ) : (
            topics.map((t) => (
              <div
                key={t.label}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 transition-colors hover:bg-zinc-100"
              >
                <span className="text-sm font-semibold text-zinc-800">
                  {formatLabel(t.label)}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  {t.count} articles
                </span>
              </div>
            ))
          )}
        </div>

        {/* Trending Players */}
        {trendingPlayers.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Hot Names
            </h3>
            <div className="grid gap-2">
              {trendingPlayers.map(([player, count]) => (
                <div
                  key={player}
                  className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5"
                >
                  <span className="text-sm font-medium text-zinc-900">
                    {player}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
                    </svg>
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </BetaSection>
  );
}
