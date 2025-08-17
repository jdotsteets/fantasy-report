// app/nfl/week/[week]/[topic]/page.tsx
import Link from "next/link";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  published_at: string | null;
  source: string;
};

const VALID_TOPICS = new Set([
  "rankings",
  "waiver-wire",
  "start-sit",
  "injury",
  "trade",
  "dfs",
  "news",
]);

function normalizeTopic(t: string) {
  const topic = (t || "").toLowerCase();
  return VALID_TOPICS.has(topic) ? topic : "news";
}

// 👇 Next 15: params can be a Promise — await it
export default async function TopicWeekPage({
  params,
}: {
  params: Promise<{ week: string; topic: string }>;
}) {
  const { week, topic: rawTopic } = await params;

  const weekNum = Number(week);
  const topic = normalizeTopic(rawTopic);

  const { rows } = await query(
    `
    select a.id, a.title, a.url, a.published_at, s.name as source
    from articles a
    join sources s on s.id = a.source_id
    where a.sport = 'nfl'
      and ($1 = 'news' or $1 = any(a.topics))
      and ($2::int is null or a.week = $2::int)
    order by a.published_at desc nulls last, a.discovered_at desc
    limit 100
  `,
    [topic, Number.isFinite(weekNum) ? weekNum : null]
  );

  const articles = rows as ArticleRow[];

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-5">
      <div className="text-sm text-gray-500">
        <Link href="/" className="hover:underline">
          ← Home
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold capitalize">
          {topic.replace("-", " ")} {Number.isFinite(weekNum) ? `– Week ${weekNum}` : ""}
        </h1>
        <p className="text-gray-600">
          Curated links for {topic.replace("-", " ")}{" "}
          {Number.isFinite(weekNum) ? `in Week ${weekNum}` : "across all weeks"}.
        </p>
      </header>

      {articles.length === 0 ? (
        <div className="text-gray-500">No articles yet for this view.</div>
      ) : (
        <ul className="space-y-3">
          {articles.map((r) => (
            <li key={r.id} className="flex flex-col">
              <div className="flex items-center gap-2">
                <a className="text-blue-600 hover:underline" href={`/go/${r.id}`} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
                <span className="text-sm text-gray-500">({r.source})</span>
              </div>
              <div className="text-xs text-gray-500">
                {r.published_at ? new Date(r.published_at).toLocaleString() : "—"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
