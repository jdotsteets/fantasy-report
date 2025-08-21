// app/nfl/week/[week]/[topic]/page.tsx
import { query } from "@/lib/db";
import ArticleLink, { Article } from "@/components/ArticleLink";
import SiteHeader from "@/components/SiteHeader";
import { notFound } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { week: string; topic: string };

export default async function TopicWeekPage(
  { params }: { params: Promise<Params> } // <- Promise here is REQUIRED in Next 15
) {
  const { week, topic } = await params; // <- and we await it

  const weekNum = Number(week);
  if (!Number.isFinite(weekNum) || weekNum < 0) {
    notFound();
  }

  const t = (topic ?? "news").toString();

  const { rows } = await query(
    `
      select
        a.id,
        coalesce(a.cleaned_title, a.title) as title,
        a.url,
        a.published_at,
        a.topics,
        a.week,
        s.name as source,
        coalesce(a.popularity_score, a.popularity, 0) as popularity
      from articles a
      join sources s on s.id = a.source_id
      where a.sport = 'nfl'
        and a.week = $1
        and (
          $2 = 'news'
          or a.topics @> ARRAY[$2]::text[]
          or ($2 = 'news' and (a.topics is null or array_length(a.topics, 1) = 0))
        )
      order by
        a.published_at desc nulls last,
        a.discovered_at desc,      
        coalesce(a.popularity_score, a.popularity, 0) desc

      limit 200
    `,
    [weekNum, t] as const
  );

  const items = rows as Article[];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl py-6">
        <h1 className="mb-4 text-2xl font-bold">
          {t.replace(/-/g, " ")} — Week {weekNum}
        </h1>
        <ul className="divide-y divide-zinc-800 rounded border border-zinc-800 bg-zinc-900/50">
          {items.map((a) => (
            <ArticleLink key={a.id} a={a} />
          ))}
        </ul>
      </main>
    </>
  );
}
