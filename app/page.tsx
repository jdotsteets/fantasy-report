// app/page.tsx
import { query } from "@/lib/db";
import ArticleList from "@/components/ArticleList";
import TopicNav from "@/components/TopicNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  title: string;
  url: string;
  published_at: string | null;
  topics: string[] | null;
  week: number | null;
  source: string;
  clicks_7d: number;
  score: number;
};

export default async function Home() {
  let items: Row[] = [];

  try {
    const { rows } = await query<Row>(
      `
      with clicks_7d as (
        select article_id, count(*)::int as clicks_7d
        from clicks
        where clicked_at >= now() - interval '7 days'
        group by article_id
      )
      select
        a.id,
        coalesce(a.cleaned_title, a.title) as title,
        a.url,
        a.published_at,
        a.topics,
        a.week,
        s.name as source,
        coalesce(c.clicks_7d, 0) as clicks_7d,
        (
          (coalesce(c.clicks_7d, 0) * 10)::float
          + (1000.0 / greatest(1.0, extract(epoch from (now() - coalesce(a.published_at, a.discovered_at))) / 3600.0))
        ) as score
      from articles a
      join sources s on s.id = a.source_id
      left join clicks_7d c on c.article_id = a.id
      where a.sport = 'nfl'
      order by score desc, a.published_at desc nulls last, a.id desc
      limit 50
      `
    );

    items = rows;
  } catch {
    items = [];
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-3xl font-bold">Fantasy Football Aggregator</h1>
      <p className="text-gray-600">Fresh links from around the web.</p>

      {/* Simple nav to common topics */}
      <TopicNav />

      <ArticleList items={items} />
    </main>
  );
}
