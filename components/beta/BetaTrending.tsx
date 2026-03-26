import type { Article } from "@/types/sources";
import BetaSection from "@/components/beta/BetaSection";

function extractPlayers(articles: Article[]): Map<string, number> {
  const mentions = new Map<string, number>();
  const twoWord = /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g;
  const skip = new Set(["Fantasy Football", "NFL", "Week", "New York", "New England", "New Orleans", "Los Angeles", "San Francisco", "Green Bay", "Kansas City", "Las Vegas", "Tampa Bay"]);
  
  articles.forEach(a => {
    const matches = (a.title || "").match(twoWord) || [];
    matches.forEach(name => {
      if (!skip.has(name) && name.length > 5) {
        mentions.set(name, (mentions.get(name) || 0) + 1);
      }
    });
  });
  
  return mentions;
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
    case "waiver-wire": return "Waiver Wire";
    case "start-sit": return "Start/Sit";
    case "dfs": return "DFS";
    case "injury": return "Injuries";
    case "rankings": return "Rankings";
    case "advice": return "Advice";
    default: return label.replace(/\b\w/g, (m) => m.toUpperCase());
  }
}

export default function BetaTrending({ articles }: { articles: Article[] }) {
  const topics = collectTopics(articles);
  const playerMentions = extractPlayers(articles);
  const trendingPlayers = Array.from(playerMentions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .filter(([_, count]) => count >= 2);

  return (
    <BetaSection
      title="Trending topics"
      subtitle="Most-covered themes across the last 48 hours"
    >
      <div className="space-y-4">
        <div className="grid gap-2">
          {topics.length === 0 ? (
            <p className="text-sm text-zinc-500">No trending signals yet.</p>
          ) : (
            topics.map((t) => (
              <div
                key={t.label}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2"
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

        {trendingPlayers.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              🔥 Hot Names
            </h3>
            <div className="grid gap-2">
              {trendingPlayers.map(([player, count]) => (
                <div
                  key={player}
                  className="flex items-center justify-between rounded-lg border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-2"
                >
                  <span className="text-sm font-semibold text-zinc-900">
                    {player}
                  </span>
                  <span className="text-xs font-bold text-orange-600">
                    {count}x
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
