// app/nfl/week/[week]/[topic]/page.tsx
import { query } from "@/lib/db";
import ArticleList from "@/components/ArticleList";
import TopicNav from "@/components/TopicNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 15 passes params as a Promise
type Params = Promise<{ week: string; topic: string }>;

export default async function Page({ params }: { params: Params }) {
  const { week, topic } = await params;
  const weekNum = Number(week);

  const { rows } = await query(
    `select
       a.id,
       coalesce(a.cleaned_title, a.title) as title,
       a.url,
       a.published_at,
       a.topics,
       a.week,
       s.name as source
     from articles a
     join sources s on s.id = a.source_id
     where a.sport = 'nfl'
       and ($1 = any(a.topics))
       and (a.week = $2)
     order by a.published_at desc nulls last, a.id desc
     limit 100`,
    [topic, isFinite(weekNum) ? weekNum : null]
  );

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold capitalize">
        {topic.replace("-", " ")} — Week {week}
      </h1>
      <ArticleList items={rows as any[]} />
    </main>
  );
}
