// app/nfl/[topic]/page.tsx
import { query } from "@/lib/db";
import ArticleLink, { Article } from "@/components/ArticleLink";
import SiteHeader from "@/components/SiteHeader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  news: "Headlines",
  "waiver-wire": "Waiver Wire",
  rankings: "Rankings",
  "start-sit": "Start/Sit",
  injury: "Injuries",
  dfs: "DFS",
};

export default async function TopicPage({
  params,
  searchParams,
}: {
  params: { topic: string };
  searchParams: { week?: string };
}) {
  const t = params.topic;
  const week = searchParams.week ? parseInt(searchParams.week, 10) : null;

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
      and (a.topics @> ARRAY[$1]::text[] or ($1 = 'news' and (a.topics is null or array_length(a.topics,1)=0)))
      ${week ? "and a.week = $2" : ""}
    order by coalesce(a.popularity,0) desc,
             a.published_at desc nulls last,
             a.discovered_at desc
    limit 200
    `,
    week ? [t, week] : [t]
  );

  const items = rows as Article[];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl py-6">
        <h1 className="mb-4 text-2xl font-bold">
          {LABELS[t] || t} {week ? `— Week ${week}` : ""}
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
