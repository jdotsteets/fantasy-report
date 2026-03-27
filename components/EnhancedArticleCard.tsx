import type { Article } from "@/types/sources";
import TimeAgo from "@/components/TimeAgo";
import Link from "next/link";
import { getSafeImageUrl, FALLBACK } from "@/lib/images";

type Props = {
  article: Article;
  showImage?: boolean;
  featured?: boolean;
};

export default function EnhancedArticleCard({ article, showImage = true, featured = false }: Props) {
  const imageUrl = getSafeImageUrl(article);
  const hasImage = imageUrl && imageUrl !== FALLBACK;
  
  return (
    <Link
      href={article.url || article.canonical_url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-xl border transition-all hover:shadow-lg ${
        featured 
          ? 'featured-story border-blue-300 p-4' 
          : 'border-zinc-200 bg-white p-3 hover:border-zinc-300'
      }`}
    >
      {showImage && hasImage && (
        <img 
          src={imageUrl} 
          alt={article.title}
          className="mb-3 h-48 w-full rounded-lg object-cover"
        />
      )}
      
      <div className="space-y-2">
        <h3 className={`font-semibold text-zinc-900 ${featured ? 'text-lg' : 'text-base'} line-clamp-2`}>
          {article.title}
        </h3>
        
        <div className="flex items-center justify-between text-xs text-zinc-600">
          {article.source && (
            <span className="font-medium">{article.source}</span>
          )}
          {article.published_at && (
            <TimeAgo date={article.published_at} className="text-xs text-zinc-500" />
          )}
        </div>
      </div>
    </Link>
  );
}
