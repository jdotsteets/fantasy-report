import Link from "next/link";

type FilterOption = {
  label: string;
  value: string;
};

type ContextualFiltersProps = {
  sectionName: string | null;
  activeFilter: string;
};

// Define contextual filters based on section
function getFiltersForSection(section: string | null): FilterOption[] {
  if (!section) return [];
  
  switch (section) {
    case "news":
      return [
        { label: "All", value: "all" },
        { label: "QB", value: "qb" },
        { label: "RB", value: "rb" },
        { label: "WR", value: "wr" },
        { label: "TE", value: "te" },
        { label: "Injuries", value: "injury" },
        { label: "Trades", value: "trade" },
      ];
    
    case "rankings":
      return [
        { label: "All", value: "all" },
        { label: "QB", value: "qb" },
        { label: "RB", value: "rb" },
        { label: "WR", value: "wr" },
        { label: "TE", value: "te" },
      ];
    
    case "start-sit":
      return [
        { label: "All", value: "all" },
        { label: "QB", value: "qb" },
        { label: "RB", value: "rb" },
        { label: "WR", value: "wr" },
        { label: "TE", value: "te" },
      ];
    
    case "waivers":
      return [
        { label: "All", value: "all" },
        { label: "QB", value: "qb" },
        { label: "RB", value: "rb" },
        { label: "WR", value: "wr" },
        { label: "TE", value: "te" },
        { label: "Deep", value: "stash" },
      ];
    
    case "dfs":
      return [
        { label: "All", value: "all" },
        { label: "QB", value: "qb" },
        { label: "RB", value: "rb" },
        { label: "WR", value: "wr" },
        { label: "TE", value: "te" },
        { label: "Stacks", value: "stack" },
      ];
    
    case "advice":
      return [
        { label: "All", value: "all" },
        { label: "Strategy", value: "strategy" },
        { label: "Buy Low", value: "buy" },
        { label: "Sell High", value: "sell" },
        { label: "Sleepers", value: "sleeper" },
      ];
    
    case "injury":
      return [
        { label: "All", value: "all" },
        { label: "QB", value: "qb" },
        { label: "RB", value: "rb" },
        { label: "WR", value: "wr" },
        { label: "TE", value: "te" },
        { label: "Returns", value: "return" },
      ];
    
    default:
      return [];
  }
}

function getSectionDisplayName(section: string | null): string {
  if (!section) return "All Content";
  
  switch (section) {
    case "news": return "News";
    case "rankings": return "Rankings";
    case "start-sit": return "Start/Sit";
    case "waivers": return "Waiver Wire";
    case "advice": return "Advice";
    case "dfs": return "DFS";
    case "injury": return "Injuries";
    default: return section.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export default function ContextualFilters({ sectionName, activeFilter }: ContextualFiltersProps) {
  const filters = getFiltersForSection(sectionName);
  
  // Don't show filters if section has none defined or if no section selected
  if (filters.length === 0 || !sectionName) return null;
  
  const displayName = getSectionDisplayName(sectionName);
  
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">
          Filter within {displayName}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((filter) => (
            <Link
              key={filter.value}
              href={`/?section=${sectionName}&filter=${filter.value}`}
              className={
                activeFilter === filter.value
                  ? "rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors"
                  : "rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-600 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
              }
              aria-current={activeFilter === filter.value ? "page" : undefined}
            >
              {filter.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// Server-side filter matching helper
export function articleMatchesFilter(
  article: { topics?: readonly string[] | null; title?: string },
  filterValue: string
): boolean {
  if (filterValue === "all") return true;
  
  const title = (article.title ?? "").toLowerCase();
  const topics = article.topics ?? [];
  
  // Position filters
  if (["qb", "rb", "wr", "te"].includes(filterValue)) {
    const posPattern = new RegExp(`\\b${filterValue}\\b`, "i");
    return posPattern.test(title) || topics.some(t => posPattern.test(t));
  }
  
  // Keyword filters
  const patterns: Record<string, RegExp> = {
    injury: /\b(injury|hurt|status|return|ir|out|doubtful|questionable)\b/i,
    trade: /\b(trade|traded|deal|acquire|swap)\b/i,
    sleeper: /\b(sleeper|emerge|breakout|rising|value)\b/i,
    bust: /\b(bust|fade|avoid|overhyped|risk)\b/i,
    adp: /\b(adp|average\s+draft|draft\s+position|draft\s+value)\b/i,
    strategy: /\b(strategy|approach|game\s+plan|philosophy)\b/i,
    breakout: /\b(breakout|emerge|stock\s+up)\b/i,
    stash: /\b(stash|deep|sleeper|hold)\b/i,
    stack: /\b(stack|correlated|lineup\s+build)\b/i,
    value: /\b(value|bargain|underpriced|cheap)\b/i,
    buy: /\b(buy\s+low|acquire|target)\b/i,
    sell: /\b(sell\s+high|move|trade\s+away)\b/i,
    return: /\b(return|back|cleared|activated|practice)\b/i,
  };
  
  const pattern = patterns[filterValue];
  if (!pattern) return false;
  
  return pattern.test(title) || topics.some(t => pattern.test(t));
}
