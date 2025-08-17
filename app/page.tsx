// app/page.tsx
import { query } from "@/lib/db";

export default async function Home() {
  const { rows } = await query(`
    select a.id, a.title, a.url, a.published_at, s.name as source
    from articles a
    join sources s on s.id = a.source_id
    where a.sport='nfl'
    order by a.published_at desc nulls last
    limit 30
  `);

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-3xl font-bold">Fantasy Football Aggregator</h1>
      <p className="text-gray-600">Fresh links from around the web.</p>
      <ul className="space-y-2">
        {rows.map((r: any) => (
          <li key={r.id} className="flex items-center gap-2">
            <a className="text-blue-600 hover:underline" href={r.url} target="_blank">
              {r.title}
            </a>
            <span className="text-sm text-gray-500">({r.source})</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
