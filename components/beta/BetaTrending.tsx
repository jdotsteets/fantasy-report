import type { Article } from "@/types/sources";
import BetaSection from "@/components/beta/BetaSection";

function isNonNFL(article: Article): boolean {
  const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
  const topics = article.topics || [];
  
  if (/baseball|mlb|yankees|dodgers/.test(text)) return true;
  if (/basketball|nba|lakers|warriors|march madness|bracket/.test(text)) return true;
  if (/hockey|nhl|stanley cup/.test(text)) return true;
  if (/fantasy baseball|fantasy basketball|fantasy hockey/.test(text)) return true;
  if (/soccer|mls|premier league/.test(text)) return true;
  
  const topicStr = topics.join(" ").toLowerCase();
  if (/baseball|basketball|hockey|soccer|mlb|nba|nhl|mls/.test(topicStr)) return true;
  
  return false;
}

function detectContext(article: Article): string | null {
  const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
  
  if (/injur|questionable|doubtful|out for|ruled out|IR/.test(text)) return "injury update";
  if (/trade|dealt|acquire|swap|package/.test(text)) return "trade buzz";
  if (/sign|contract|extension|landing spot/.test(text)) return "signing impact";
  if (/touches|target share|snap|usage|workload|volume/.test(text)) return "workload concerns";
  if (/depth chart|starter|backup|rb1|wr1|rotation/.test(text)) return "role battle";
  if (/breakout|sleeper|emerge|rising|stock up/.test(text)) return "breakout buzz";
  if (/waiver|add|drop|pickup|under.owned/.test(text)) return "waiver riser";
  
  return null;
}

function extractPlayers(articles: Article[]): Map<string, Article[]> {
  const playerArticles = new Map<string, Article[]>();
  const twoWord = /\b([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15})\b/g;
  
  const skip = new Set([
    "Fantasy Football", "Fantasy Baseball", "Fantasy Basketball", "Fantasy Hockey",
    "NFL", "NBA", "MLB", "NHL", "MLS",
    "Week", "Year", "Season", "Game", "Super Bowl", "Pro Bowl",
    "New York", "New England", "New Orleans", "Los Angeles", "San Francisco",
    "Green Bay", "Kansas City", "Las Vegas", "Tampa Bay",
    "Free Agency", "Mock Draft", "Dynasty Fantasy", "Draft Big",
    "Waiver Wire", "Trade Deadline", "Injury Report",
    "Draft Kings", "Fan Duel", "Yahoo Sports", "Pro Football",
    "Fantasy Report", "The Athletic", "Roto World", "Fantasy Pros",
    "March Madness", "Sweet Sixteen", "Elite Eight", "For The",
    "Ohio State", "Running Backs", "Wide Receivers", "Tight Ends",
    "Arizona Cardinals", "Rooney Rule", "Carnell Tate"
  ]);
  
  for (const article of articles) {
    if (isNonNFL(article)) continue;
    
    const text = article.title || "";
    let m: RegExpExecArray | null;
    
    while ((m = twoWord.exec(text)) !== null) {
      const name = m[1];
      if (skip.has(name)) continue;
      
      if (name.includes("Report") || name.includes("News") || 
          name.includes("Update") || name.includes("Trade") ||
          name.includes("Week") || name.includes("Draft") ||
          name.includes("Mock") || name.includes("Fantasy")) continue;
      
      const parts = name.split(" ");
      if (parts[0].length < 2 || parts[1].length < 2) continue;
      if (parts[0].length > 12 || parts[1].length > 12) continue;
      
      const existing = playerArticles.get(name);
      if (existing) {
        existing.push(article);
      } else {
        playerArticles.set(name, [article]);
      }
    }
  }
  
  return playerArticles;
}

type TrendingItem = {
  player: string;
  context: string;
  count: number;
};

function buildTrendingClusters(articles: Article[]): TrendingItem[] {
  const playerArticles = extractPlayers(articles);
  const clusters: TrendingItem[] = [];
  
  for (const [playerName, playerArticleList] of playerArticles.entries()) {
    if (!playerArticleList || playerArticleList.length === 0) continue;
    
    const contexts: string[] = [];
    for (const a of playerArticleList) {
      const ctx = detectContext(a);
      if (ctx) contexts.push(ctx);
    }
    
    if (contexts.length === 0) continue;
    
    const contextCounts = new Map<string, number>();
    for (const c of contexts) {
      contextCounts.set(c, (contextCounts.get(c) || 0) + 1);
    }
    
    const sortedContexts = Array.from(contextCounts.entries()).sort((a, b) => b[1] - a[1]);
    if (sortedContexts.length === 0) continue;
    
    const primaryContext = sortedContexts[0][0];
    
    clusters.push({
      player: playerName,
      context: primaryContext,
      count: playerArticleList.length
    });
  }
  
  // Sort by count desc (no date sorting to avoid previous errors)
  clusters.sort((a, b) => b.count - a.count);
  
  const strong = clusters.filter(c => c.count >= 2).slice(0, 8);
  
  if (strong.length < 6) {
    const weak = clusters.filter(c => c.count === 1).slice(0, Math.max(0, 6 - strong.length));
    return [...strong, ...weak];
  }
  
  return strong;
}

export default function BetaTrending({ articles }: { articles: Article[] }) {
  if (!articles || articles.length === 0) {
    return (
      <BetaSection
        title="🔥 Trending Now"
        subtitle="Hot players and storylines from the last 48 hours"
      >
        <p className="text-sm text-zinc-500">No trending players yet.</p>
      </BetaSection>
    );
  }

  const trending = buildTrendingClusters(articles);

  return (
    <BetaSection
      title="🔥 Trending Now"
      subtitle="Hot players and storylines from the last 48 hours"
    >
      <div className="space-y-2">
        {trending.length === 0 ? (
          <p className="text-sm text-zinc-500">No trending players yet.</p>
        ) : (
          trending.map((item) => (
            <button
              key={`${item.player}-${item.context}-${item.count}`}
              onClick={() => {
                // Filter articles by this player name
                const searchBox = document.querySelector('input[type="search"]') as HTMLInputElement;
                if (searchBox) {
                  searchBox.value = item.player;
                  searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                  searchBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }}
              className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-2 text-left transition-all hover:border-orange-400 hover:shadow-md"
            >
              <div className="flex-1">
                <span className="text-sm font-semibold text-zinc-900">
                  {item.player}
                </span>
                <span className="ml-2 text-sm text-zinc-600">
                  {item.context}
                </span>
              </div>
              <span className="ml-3 text-xs font-medium text-orange-600">
                {item.count}
              </span>
            </button>
          ))
        )}
      </div>
    </BetaSection>
  );
}
