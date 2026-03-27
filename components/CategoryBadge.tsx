// CategoryBadge.tsx - Visual category indicators
export default function CategoryBadge({ category }: { category: string }) {
  const badges: Record<string, { emoji: string; color: string; label: string }> = {
    news: { emoji: "📰", color: "bg-blue-100 text-blue-700", label: "News" },
    rankings: { emoji: "📊", color: "bg-purple-100 text-purple-700", label: "Rankings" },
    "start-sit": { emoji: "⚡", color: "bg-amber-100 text-amber-700", label: "Start/Sit" },
    advice: { emoji: "💡", color: "bg-green-100 text-green-700", label: "Advice" },
    dfs: { emoji: "💰", color: "bg-emerald-100 text-emerald-700", label: "DFS" },
    "waiver-wire": { emoji: "🔄", color: "bg-cyan-100 text-cyan-700", label: "Waivers" },
    injury: { emoji: "🏥", color: "bg-red-100 text-red-700", label: "Injury" },
  };
  
  const badge = badges[category] || badges.news;
  
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${badge.color}`}>
      <span>{badge.emoji}</span>
      <span>{badge.label}</span>
    </span>
  );
}
