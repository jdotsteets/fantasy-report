import type { Article } from "@/types/sources";
import BetaSection from "@/components/beta/BetaSection";

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

  return (
    <BetaSection
      title="Trending topics"
      subtitle="Most-covered themes across the last 48 hours"
    >
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
                {t.count} hits
              </span>
            </div>
          ))
        )}
      </div>
    </BetaSection>
  );
}
