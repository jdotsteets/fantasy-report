import type { TopicKey } from "@/types/sources";

const TOPIC_LABELS: Record<string, string> = {
  news: "News",
  rankings: "Rankings",
  "start-sit": "Start/Sit",
  "waiver-wire": "Waiver Wire",
  injury: "Injuries",
  dfs: "DFS",
  advice: "Advice",
};

function labelFor(topic: string) {
  return TOPIC_LABELS[topic] ?? topic.replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function BetaTopicPills({
  topics,
}: {
  topics: readonly (TopicKey | string)[];
}) {
  const unique = Array.from(new Set(topics.filter(Boolean)));
  if (unique.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {unique.slice(0, 4).map((t) => (
        <span
          key={t}
          className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600"
        >
          {labelFor(t)}
        </span>
      ))}
    </div>
  );
}
