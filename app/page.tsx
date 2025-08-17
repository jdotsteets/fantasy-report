// app/page.tsx
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  published_at: string | null;
  topics: string[] | null;
  week: number | null;
  source: string;
};

export default async function Home() {
  let articles: ArticleRow[] = [];

  try {
    const { rows } = await query(`
      select a.id, a.title, a.url, a.published_at, a.topics, a.week, s.name as source
      from articles a
      join sources s on s.id = a.source_id
      where a.sport='nfl'
      order by a.published_at desc nulls last, a.discovered_at desc
      limit 50
    `);
    articles = rows as ArticleRow[];
  } catch {
    articles = [];
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-3xl font-bold">Fantasy Football Aggregator</h1>
      <p className="text-gray-600">Fresh links from around the web.</p>

      {articles.length === 0 ? (
        <div className="text-gray-500">
          No articles yet. Visit <code>/api/ingest</code>.
        </div>
      ) : (
        <ul className="space-y-3">
          {articles.map((r) => (
            <li key={r.id} className="flex flex-col">
              <div className="flex items-center gap-2">
                <a
                  className="text-blue-600 hover:underline"
                  href={`/go/${r.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {r.title}
                </a>
                <span className="text-sm text-gray-500">({r.source})</span>
              </div>
              <div className="text-xs text-gray-500">
                {r.published_at ? new Date(r.published_at).toLocaleString() : "—"}
                {Array.isArray(r.topics) && r.topics.length > 0 && (
                  <>
                    {" "}
                    • {r.topics.join(", ")}
                    {r.week ? ` • Week ${r.week}` : ""}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
