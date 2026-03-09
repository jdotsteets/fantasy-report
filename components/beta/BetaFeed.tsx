import type { Article } from "@/types/sources";
import BetaArticleCard from "@/components/beta/BetaArticleCard";

export default function BetaFeed({ articles, limit }: { articles: Article[]; limit?: number }) {
  const list = typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? articles.slice(0, limit)
    : articles;

  return (
    <div className="grid gap-4">
      {list.map((article, idx) => (
        <BetaArticleCard key={article.id} article={article} index={idx} />
      ))}
    </div>
  );
}
