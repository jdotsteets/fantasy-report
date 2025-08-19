// app/nfl/week/[week]/page.tsx
import { query } from "@/lib/db";
import ArticleLink, { Article } from "@/components/ArticleLink";
import SiteHeader from "@/components/SiteHeader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WeekPage({ params }: { params: { week: string } }) {
  const w = parseInt(params.week, 10);
  const { rows } = await query(
    `
    select a.id,
           coalesce(a.cleaned_title, a.title) as title,
           a.url,
           a.published_at,
           a.topics,
           a.week,
           s.name as source,
           a.popularity
    from articles a
    join sources s on s.id = a.source_id
    where a.sport='nfl'
      and a.week = $1
    order by coalesce(a.popularity,0) desc,
             a.published_at desc nulls last,
             a.discovered_at desc
    limit 300
    `,
    [w]
  );
  const items = rows as Article[];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl py-6">
        <h1 className="mb-4 text-2xl font-bold">All Topics — Week {w}</h1>
        <ul className="divide-y divide-zinc-800 rounded border border-zinc-800 bg-zinc-900/50">
          {items.map((a) => (
            <ArticleLink key={a.id} a={a} />
          ))}
        </ul>
      </main>
    </>
  );
}
