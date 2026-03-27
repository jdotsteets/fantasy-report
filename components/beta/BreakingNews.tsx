import type { Article } from "@/types/sources";
import TimeAgo from "@/components/TimeAgo";
import Link from "next/link";

export default function BreakingNews({ articles }: { articles: Article[] }) {
  // Only show articles from the last 6 hours
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  
  const breaking = articles.filter(a => {
    if (!a.published_at) return false;
    const pubDate = new Date(a.published_at);
    return pubDate > sixHoursAgo;
  }).slice(0, 5);
  
  if (breaking.length === 0) return null;
  
  return (
    <div className="rounded-xl border-2 border-red-200 bg-gradient-to-r from-red-50 to-orange-50 p-4 shadow-md">
      <div className="mb-3 flex items-center gap-2">
        <span className="breaking-badge">⚡ Breaking</span>
        <span className="text-xs font-semibold text-zinc-600">Last 6 hours</span>
      </div>
      
      <div className="space-y-2">
        {breaking.map((article, i) => (
          <Link
            key={article.id || i}
            href={article.url || article.canonical_url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-red-200 bg-white p-3 transition-all hover:border-red-400 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-zinc-900 line-clamp-2">
                  {article.title}
                </h3>
                {article.source && (
                  <p className="mt-1 text-xs text-zinc-500">{article.source}</p>
                )}
              </div>
              {article.published_at && (
                <TimeAgo 
                  date={article.published_at} 
                  className="shrink-0 text-xs font-semibold text-red-600"
                />
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
