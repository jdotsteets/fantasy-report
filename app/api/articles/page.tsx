// app/page.tsx
import { query } from "@/lib/db";
import SiteHeader from "@/components/SiteHeader";
import TopicSection from "@/components/TopicSection";
import { Article } from "@/components/ArticleLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOPIC_ORDER: Array<{ key: string; label: string }> = [
  { key: "news", label: "Headlines" },
  { key: "waiver-wire", label: "Waiver Wire" },
  { key: "rankings", label: "Rankings" },
  { key: "start-sit", label: "Start/Sit" },
  { key: "injury", label: "Injuries" },
  { key: "dfs", label: "DFS" },
];

export default async function Home({ searchParams }: { searchParams: { week?: string } }) {
  const week = searchParams.week ? parseInt(searchParams.week, 10) : null;

  // Pull recent articles once, then group in memory (fast + simple)
  const { rows } = await query(
    `
    with base as (
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
        ${week ? "and a.week = $1" : ""}
      order by coalesce(a.popularity,0) desc,
               a.published_at desc nulls last,
               a.discovered_at desc
      limit 300
    )
    select * from base
    `,
    week ? [week] : []
  );

  const all = rows as Article[];

  // Group by topic buckets
  const grouped: Record<string, Article[]> = {
    news: [],
    "waiver-wire": [],
    rankings: [],
    "start-sit": [],
    injury: [],
    dfs: [],
  };

  for (const a of all) {
    const topics = (a.topics || []) as string[];
    // if “news”, we treat as default bucket
    const target = topics.find((t) => grouped[t as keyof typeof grouped]) || "news";
    grouped[target].push(a);
  }

  // Right sidebar: latest added (first 15 regardless of topic)
  const latest = all.slice(0, 15);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 py-6 md:grid-cols-3">
        {/* Main columns (span 2) */}
        <div className="md:col-span-2">
          {TOPIC_ORDER.map(({ key, label }) => (
            <TopicSection
              key={key}
              title={label}
              href={`/nfl/${key}${week ? `?week=${week}` : ""}`}
              items={grouped[key].slice(0, 10)}
            />
          ))}
        </div>

        {/* Sidebar */}
        <aside className="md:col-span-1">
          <section className="mb-8">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Latest Added
            </h3>
            <ul className="divide-y divide-zinc-800 rounded border border-zinc-800 bg-zinc-900/50">
              {latest.map((a) => (
                <li key={a.id} className="py-2 px-3">
                  <a
                    href={`/go/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="line-clamp-2 text-sm text-zinc-200 hover:text-white"
                  >
                    {a.title}
                  </a>
                  <div className="mt-1 text-xs text-zinc-400">{a.source}</div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </main>
    </>
  );
}
