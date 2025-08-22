// app/page.tsx
import { query } from "@/lib/db";
import ArticleList from "@/components/ArticleList";
import Section from "@/components/Section";
import TopicNav from "@/components/TopicNav";
import Hero from "@/components/Hero";
import FantasyLinks from "@/components/FantasyLinks";
import ArticleLink from "@/components/ArticleLink";
import type { Article } from "@/types/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SQLParam = string | number | boolean | null | Date;
type Search = { week?: string };

type ArticleRow = Article;

type HeroData = {
  title: string;
  href: string;
  src: string;
  source: string;
};

/** Compute the NFL "current week" */
function getCurrentNFLWeek(now = new Date()): number {
  const year = now.getUTCFullYear();
  const sept1 = new Date(Date.UTC(year, 8, 1));
  const day = sept1.getUTCDay();
  const laborDay = new Date(Date.UTC(year, 8, 1 + ((8 - day) % 7)));
  const thursday = new Date(laborDay);
  thursday.setUTCDate(laborDay.getUTCDate() + 3);
  if (now < thursday) return 0;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return 1 + Math.floor((now.getTime() - thursday.getTime()) / weekMs);
}

function weekLabel(week: number) {
  return week === 0 ? "Preseason" : `Week ${week}`;
}

async function fetchArticles(
  whereSql: string,
  params: ReadonlyArray<SQLParam> = [],
  limit = 15
): Promise<ArticleRow[]> {
  // put limit at the end; compute its placeholder index
  const limitParamIndex = params.length + 1;
  const allParams: ReadonlyArray<SQLParam> = [...params, limit];

  const { rows } = await query<ArticleRow>(
    `
      select
        a.id,
        coalesce(a.cleaned_title, a.title) as title,
        a.url,
        a.canonical_url,
        a.domain,
        a.published_at,
        a.topics,
        a.week,
        s.name as source
      from articles a
      join sources s on s.id = a.source_id
      where a.sport = 'nfl'
        ${whereSql}
      order by
        a.published_at desc nulls last,
        a.discovered_at desc,
        coalesce(a.popularity_score, 0) desc
      limit $${limitParamIndex}
    `,
    allParams
  );

  return rows as ArticleRow[];
}


// For the hero we need image/source/url/title; pull one promising item
async function fetchHero(): Promise<HeroData | null> {
  const { rows } = await query(
    `
      select
        a.id,
        coalesce(a.cleaned_title, a.title) as title,
        a.url,
        s.name as source,
        a.image_url
      from articles a
      join sources s on s.id = a.source_id
      where a.sport='nfl'
      order by
        coalesce(a.popularity_score, 0) desc,
        a.published_at desc nulls last,
        a.discovered_at desc
      limit 1
    `
  );

  const r = rows?.[0] as
    | { id: number; title: string; url: string; source: string; image_url: string | null }
    | undefined;

  return r
    ? {
        title: r.title,
        href: `/go/${r.id}`,
        src: r.image_url || "",
        source: r.source,
      }
    : null;
}

export default async function Home(props: { searchParams?: Promise<Search> }) {
  const sp = props.searchParams ? await props.searchParams : {};
  const urlWeek = Number(sp.week);
  const CURRENT_WEEK = Number.isFinite(urlWeek) ? urlWeek : getCurrentNFLWeek();

  // Sections
  const latest = await fetchArticles("", [], 25);
  const rankings = await fetchArticles(`and a.topics @> ARRAY['rankings']::text[]`, [], 10);
  const startSit = await fetchArticles(`and a.topics @> ARRAY['start-sit']::text[] and coalesce(a.week, 0) = $1`,[CURRENT_WEEK],12);
  const advice = await fetchArticles(`and a.topics @> ARRAY['advice']::text[]`,[],10);
  const dfs = await fetchArticles(`and a.topics @> ARRAY['dfs']::text[]`, [], 10);
  const waivers = await fetchArticles(`and a.topics @> ARRAY['waiver-wire']::text[]`, [], 10);
  const injuries = await fetchArticles(`and a.topics @> ARRAY['injury']::text[]`, [], 10);

  const hero = await fetchHero();

  return (
    <main className="mx-auto w-full px-4 py-6">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-black">
          The Fantasy Report
        </h1>
        <p className="mt-1 text-zinc-600">News, Updates, Rankings, and Advice from the experts.</p>
        <div className="mt-4">
          <TopicNav />
        </div>
      </header>

      {/* Optional hero under pills */}
      {hero?.src ? (
        <div className="mb-8">
          <Hero title={hero.title} href={hero.href} src={hero.src} source={hero.source} />
        </div>
      ) : null}

      {/* 3-column layout */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_1.2fr_1fr]">
        {/* LEFT: Rankings + Start/Sit + Waiver Wire (waivers last in this column) */}
        <div className="order-2 md:order-1 space-y-4">
          <Section title="Rankings">
            <ArticleList items={rankings} />
          </Section>

          <Section title={`${weekLabel(CURRENT_WEEK)} Start/Sit & Sleepers`}>
            <ArticleList items={startSit} />
          </Section>

          <Section title="Waiver Wire">
            <ArticleList items={waivers} />
          </Section>

          
        </div>

        {/* MIDDLE: Latest */}
        <div className="order-1 md:order-2 space-y-4">
          <Section title="News & Updates">
            <ArticleList items={latest} />
          </Section>
        </div>

        {/* RIGHT: DFS, Injuries, Sites (sites last) */}
        <div className="order-3 space-y-4">

          <Section title="Advice">
            <ArticleList items={advice} />
          </Section>  
                    
          <Section title="DFS">
            <ArticleList items={dfs} />
          </Section>

          <Section title="Injuries">
            <ArticleList items={injuries} />
          </Section>

          <Section title="Sites">
            {/* pulls from the sources table, excludes team sites, news first */}
            <FantasyLinks />
          </Section>
        </div>
      </div>
    </main>
  );
}
