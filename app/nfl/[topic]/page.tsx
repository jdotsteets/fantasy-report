// app/nfl/[topic]/page.tsx
import { query } from "@/lib/db";
import ArticleLink, { Article } from "@/components/ArticleLink";
import SiteHeader from "@/components/SiteHeader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { topic: string };
type Search = Record<string, string | string[] | undefined>;

const LABELS: Record<string, string> = {
  news: "Headlines",
  "waiver-wire": "Waiver Wire",
  rankings: "Rankings",
  "start-sit": "Start/Sit",
  injury: "Injuries",
  dfs: "DFS",
};

export default async function TopicPage(
  {
    params,
    searchParams,
  }: {
    params: Promise<Params>;
    searchParams?: Promise<Search>;
  }
) {
  // ✅ Next 15: await the Promises
  const { topic } = await params;
  const sp = searchParams ? await searchParams : ({} as Search);

  // Optional week filter (?week=3). If absent, show all weeks.
  let weekNum: number | null = null;
  const rawWeek = Array.isArray(sp.week) ? sp.week[0] : sp.week;
  if (rawWeek !== undefined) {
    const n = Number(rawWeek);
    if (Number.isFinite(n) && n >= 0) weekNum = n;
  }

  const t = (topic ?? "news").toString();

  // Build WHERE — always require sport='nfl' and topic (with news special-case)
  const whereParts: string[] = [
    "a.sport = 'nfl'",
    `(
      $1 = 'news'
      or a.topics @> ARRAY[$1]::text[]
      or ($1 = 'news' and (a.topics is null or array_length(a.topics, 1) = 0))
    )`,
  ];
  const paramsArr: (string | number)[] = [t];

  if (weekNum !== null) {
    whereParts.push("a.week = $2");
    paramsArr.push(weekNum);
  }

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
      where ${whereParts.join(" and ")}
      order by
        coalesce(a.popularity_score, a.popularity, 0) desc,
        a.published_at desc nulls last,
        a.discovered_at desc
      limit 200
    `,
    paramsArr
  );

  const items = rows as Article[];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl py-6">
        <h1 className="mb-4 text-2xl font-bold">
          {LABELS[t] || t}
          {weekNum !== null ? ` — Week ${weekNum}` : ""}
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
