// app/page.tsx
import { query } from "@/lib/db";
import ArticleList from "@/components/ArticleList";
import Section from "@/components/Section";
import TopicNav from "@/components/TopicNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compute the NFL "current week":
 *  - Week 0 = preseason (before kickoff Thursday)
 *  - Week 1 starts on the first Thursday after Labor Day
 */
function getCurrentNFLWeek(now = new Date()): number {
  const year = now.getUTCFullYear();

  // Labor Day = first Monday in September
  const sept1 = new Date(Date.UTC(year, 8, 1));
  const day = sept1.getUTCDay(); // 0..6
  const offsetToMonday = (8 - day) % 7;
  const laborDay = new Date(Date.UTC(year, 8, 1 + offsetToMonday));

  // Kickoff = Thursday of that week
  const thursday = new Date(laborDay);
  thursday.setUTCDate(laborDay.getUTCDate() + 3);

  if (now < thursday) return 0; // preseason

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const diffWeeks = Math.floor((now.getTime() - thursday.getTime()) / weekMs);
  return 1 + diffWeeks; // Week 1 on kickoff Thursday
}

function weekLabel(week: number) {
  return week === 0 ? "Preseason (Week 0)" : `Week ${week}`;
}

/** Generic fetcher. Use $1, $2, ... in `whereSql` and pass params[] */
async function fetchArticles(whereSql: string, params: any[] = [], limit = 15) {
  const orderSql = `
    order by coalesce(a.popularity_score, 0) desc,
             a.published_at desc nulls last,
             a.discovered_at desc
  `;

  const { rows } = await query(
    `
      select
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
        ${whereSql}
      ${orderSql}
      limit ${limit}
    `,
    params
  );

  return rows as Array<{
    id: number;
    title: string;
    url: string;
    published_at: string | null;
    topics: string[] | null;
    week: number | null;
    source: string;
  }>;
}

type PageProps = {
  searchParams?: { week?: string };
};

export default async function Home({ searchParams }: PageProps) {
  // Allow ?week= override for testing; fallback to computed current week
  const urlWeek = Number(searchParams?.week);
  const CURRENT_WEEK = Number.isFinite(urlWeek) ? urlWeek : getCurrentNFLWeek();

  // Middle: Latest
  const latest = await fetchArticles("");

  // Left: Start/Sit for CURRENT_WEEK (preseason => 0)
  const startSit = await fetchArticles(
    `
      and a.topics @> ARRAY['start-sit']::text[]
      and coalesce(a.week, 0) = $1
    `,
    [CURRENT_WEEK]
  );

  // Right: Waiver Wire (not forced to week, but you can add the same filter)
  const waivers = await fetchArticles(
    `
      and a.topics @> ARRAY['waiver-wire']::text[]
      -- and coalesce(a.week, 0) = $1
    `,
    [] // or [CURRENT_WEEK] if you want the same filter
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Fantasy Football Aggregator
        </h1>
        <p className="mt-1 text-zinc-400">Fresh links from around the web.</p>
        <div className="mt-4">
          <TopicNav />
        </div>
      </header>

      {/* 3-column layout */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* LEFT: Start/Sit */}
        <div className="order-2 md:order-1 space-y-6">
          <Section title={`${weekLabel(CURRENT_WEEK)} Start/Sit & Sleepers`}>
            <ArticleList items={startSit} />
          </Section>
        </div>

        {/* MIDDLE: Latest */}
        <div className="order-1 md:order-2 space-y-6">
          <Section title="Latest Updates">
            <ArticleList items={latest} />
          </Section>
        </div>

        {/* RIGHT: Waiver Wire */}
        <div className="order-3 space-y-6">
          <Section title="Waiver Wire">
            <ArticleList items={waivers} />
          </Section>
        </div>
      </div>
    </main>
  );
}
