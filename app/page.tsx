// app/page.tsx
import { Suspense } from "react";
import ArticleList from "@/components/ArticleList";
import Section from "@/components/Section";
import Hero from "@/components/Hero";
import FantasyLinks from "@/components/FantasyLinks";
import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK, isLikelyFavicon } from "@/lib/images";
import ImageToggle from "@/components/ImageToggle";
import { getHomeData, type DbRow } from "@/lib/HomeData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HomePayload = {
  items: {
    latest: DbRow[];
    rankings: DbRow[];
    startSit: DbRow[];
    advice: DbRow[];
    dfs: DbRow[];
    waivers: DbRow[];
    injuries: DbRow[];
    heroCandidates: DbRow[];
  };
};

function mapRow(a: DbRow): Article {
  return {
    id: a.id,
    title: a.title,
    url: a.url,
    canonical_url: a.canonical_url,
    domain: a.domain,
    image_url: a.image_url ?? null,
    published_at: a.published_at ?? null,
    source: a.source,
  };
}

const CURRENT_WEEK = 1;
const weekLabel = (wk: number) => `Week ${wk}`;

type HeroData = { title: string; href: string; src: string; source: string };

const SECTION_KEYS = [
  "waivers",
  "rankings",
  "start-sit",
  "injury",
  "dfs",
  "advice",
  "news",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
const isSectionKey = (v: string): v is SectionKey =>
  (SECTION_KEYS as readonly string[]).includes(v);

// Next 15: searchParams must be awaited
type SP = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sport = "nfl";

  const sp = await searchParams;
  const rawSection = (Array.isArray(sp.section) ? sp.section[0] : sp.section) ?? "";
  const sectionParam = rawSection.toLowerCase().trim();
  const selected: SectionKey | null = isSectionKey(sectionParam) ? sectionParam : null;

  const show = (k: SectionKey) => selected === null || selected === k;

  const data: HomePayload = await getHomeData({
    sport,
    days: 45,
    week: CURRENT_WEEK, // only Waiver Wire uses this filter
    limitNews: 60,
    limitRankings: 10,
    limitStartSit: 12,
    limitAdvice: 10,
    limitDFS: 10,
    limitWaivers: 10,
    limitInjuries: 10,
    limitHero: 12,
  });

  const latest = data.items.latest.map(mapRow);
  const rankings = data.items.rankings.map(mapRow);
  const startSit = data.items.startSit.map(mapRow);
  const advice = data.items.advice.map(mapRow);
  const dfs = data.items.dfs.map(mapRow);
  const waivers = data.items.waivers.map(mapRow);
  const injuries = data.items.injuries.map(mapRow);

 const hasRealImage = (a: Article) => {
  const u = getSafeImageUrl(a.image_url);
  return !!u && u !== FALLBACK && !isLikelyFavicon(u);
};

  const heroRow = latest.find(hasRealImage) ?? null;

  const hero: HeroData | null = heroRow
    ? {
        title: heroRow.title,
        href: heroRow.canonical_url ?? heroRow.url ?? `/go/${heroRow.id}`,
        src: getSafeImageUrl(heroRow.image_url)!,
        source: heroRow.source,
      }
    : null;

  const heroId = heroRow?.id ?? null;
  const dropHero = <T extends { id: number }>(arr: T[]) =>
    heroId ? arr.filter((a) => a.id !== heroId) : arr;

  const latestFiltered = dropHero(latest);
  const rankingsFiltered = dropHero(rankings);
  const startSitFiltered = dropHero(startSit);
  const adviceFiltered = dropHero(advice);
  const dfsFiltered = dropHero(dfs);
  const waiversFiltered = dropHero(waivers);
  const injuriesFiltered = dropHero(injuries);

  const showHero = selected === null && hero !== null;

  return (
    <Suspense fallback={null}>
      <main className="mx-auto max-w-[100%] px-2 sm:px-6 lg:px-8 py-6">
        <header className="mb-6 text-center">
          <h1 className="font-extrabold tracking-tight text-black text-5xl sm:text-6xl md:text-7xl">
            The Fantasy Report
          </h1>
        </header>

        {showHero ? (
          <div className="mb-8 mx-auto max-w-2xl">
            <Hero title={hero!.title} href={hero!.href} src={hero!.src} source={hero!.source} />
          </div>
        ) : null}

        <div className="flex justify-end px-3 py-2">
          <ImageToggle />
        </div>

        {/* If a filter is active, render a centered single column */}
        {selected ? (
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {selected === "rankings" && (
              <Section title="Rankings">
                <ArticleList items={rankingsFiltered} />
              </Section>
            )}
            {selected === "start-sit" && (
              <Section title="Start/Sit & Sleepers">
                <ArticleList items={startSitFiltered} />
              </Section>
            )}
            {selected === "waivers" && (
              <Section title={`Waiver Wire — ${weekLabel(CURRENT_WEEK)}`}>
                <ArticleList items={waiversFiltered} />
              </Section>
            )}
            {selected === "news" && (
              <Section title="News & Updates">
                <ArticleList items={latestFiltered} />
              </Section>
            )}
            {selected === "dfs" && (
              <Section title="DFS">
                <ArticleList items={dfsFiltered} />
              </Section>
            )}
            {selected === "advice" && (
              <Section title="Advice">
                <ArticleList items={adviceFiltered} />
              </Section>
            )}
            {selected === "injury" && (
              <Section title="Injuries">
                <ArticleList items={injuriesFiltered} />
              </Section>
            )}
          </div>
        ) : (
          // Otherwise, keep the original 3-column grid
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-[1fr_1.25fr_1fr] md:gap-2">
            {/* Left column */}
            <div className="order-2 md:order-1 space-y-4">
              <Section title="Rankings">
                <ArticleList items={rankingsFiltered} />
              </Section>

              <Section title="Start/Sit & Sleepers">
                <ArticleList items={startSitFiltered} />
              </Section>

              <Section title={`Waiver Wire — ${weekLabel(CURRENT_WEEK)}`}>
                <ArticleList items={waiversFiltered} />
              </Section>
            </div>

            {/* Middle column */}
            <div className="order-1 md:order-2 space-y-4">
              <Section title="News & Updates">
                <ArticleList items={latestFiltered} />
              </Section>
            </div>

            {/* Right column */}
            <div className="order-3 md:order-3 space-y-4">
              <Section title="DFS">
                <ArticleList items={dfsFiltered} />
              </Section>
              <Section title="Advice">
                <ArticleList items={adviceFiltered} />
              </Section>
              <Section title="Injuries">
                <ArticleList items={injuriesFiltered} />
              </Section>

              <Section title="Sites">
                <FantasyLinks />
              </Section>
            </div>
          </div>
        )}
      </main>
    </Suspense>
  );
}
