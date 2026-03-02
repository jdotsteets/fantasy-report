// components/TopicSection.tsx
import ArticleLink from "@/components/ArticleLink";
import type { Article } from "@/types/sources";
import Link from "next/link";

export default function TopicSection({
  title,
  href,
  items,
}: {
  title: string;
  href: string;
  items: Article[];
}) {
  if (!items.length) return null;
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link href={href} className="text-sm text-zinc-400 hover:text-zinc-200">
          See all →
        </Link>
      </div>
      <ul className="divide-y divide-zinc-800 rounded border border-zinc-800 bg-zinc-900/50">
        {items.map((a) => (
          <ArticleLink key={a.id} article={a} />
        ))}
      </ul>
    </section>
  );
}
