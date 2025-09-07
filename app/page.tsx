// app/page.tsx
import { Suspense } from "react";
import Section from "@/components/Section";
import Hero from "@/components/Hero";
import FantasyLinks from "@/components/FantasyLinks";
import ImageToggle from "@/components/ImageToggle";
import LoadMoreSection from "@/components/LoadMoreSection";
import StaticLinksSection from "@/components/StaticLinksSection";

import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK, isLikelyFavicon } from "@/lib/images";
import { getHomeData, type DbRow } from "@/lib/HomeData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ───────────────────────── Types & constants ───────────────────────── */

type HomePayload = {
  items: {
    latest: DbRow[];
    rankings: DbRow[];
    startSit: DbRow[];
    advice: DbRow[];
    dfs: DbRow[];
    waivers: DbRow[];
    injuries: DbRow[];
    heroCandidates: DbRow[]; // (fetched by getHomeData)
  };
};

type HeroData = { title: string; href: string; src: string; source: string };

const SPORT = "nfl";
const DAYS = 45;
const CURRENT_WEEK = 1;
const weekLabel = (wk: number) => `Week ${wk}`;

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

/* ───────────────────────── Helpers ───────────────────────── */

const mapRow = (a: DbRow): Article => ({
  id: a.id,
  title: a.title,
  url: a.url,
  canonical_url: a.canonical_url,
  domain: a.domain,
  image_url: a.image_url ?? null,
  published_at: a.published_at ?? null,
  source: a.source,
});

const hasRealImage = (a: Article) => {
  const u = getSafeImageUrl(a.image_url);
  return !!u && u !== FALLBACK && !isLikelyFavicon(u);
};

const dropId =
  (id: number | null) =>
  <T extends { id: number }>(arr: T[]) =>
    id ? arr.filter((x) => x.id !== id) : arr;

/* ───────────────────────── Page ───────────────────────── */

type SP = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const rawSection =
    (Array.isArray(sp.section) ? sp.section[0] : sp.section) ?? "";
  const sectionParam = rawSection.toLowerCase().trim();
  const selected: SectionKey | null = isSectionKey(sectionParam)
    ? sectionParam
    : null;

  const data: HomePayload = await getHomeData({
    sport: SPORT,
    days: DAYS,
    week: CURRENT_WEEK, // only Waiver Wire uses this filter
    limitNews: 20,
    limitRankings: 10,
    limitStartSit: 12,
    limitAdvice: 10,
    limitDFS: 10,
    limitWaivers: 10,
    limitInjuries: 10,
    limitHero: 12,
  });

  // Normalize to Article[]
  const latest = data.items.latest.map(mapRow);
  const rankings = data.items.rankings.map(mapRow);
  const startSit = data.items.startSit.map(mapRow);
  const advice = data.items.advice.map(mapRow);
  const dfs = data.items.dfs.map(mapRow);
  const waivers = data.items.waivers.map(mapRow);
  const injuries = data.items.injuries.map(mapRow);

  // Pick a hero, then drop it from each list to avoid duplication
  const heroRow = latest.find(hasRealImage) ?? null;
  const hero: HeroData | null = heroRow
    ? {
        title: heroRow.title,
        href: heroRow.canonical_url ?? heroRow.url ?? `/go/${heroRow.id}`,
        src: getSafeImageUrl(heroRow.image_url)!,
        // ensure string for the Hero component
        source: heroRow.source ?? "",
      }
    : null;

  const removeHero = dropId(heroRow?.id ?? null);
  const latestFiltered = removeHero(latest);
  const rankingsFiltered = removeHero(rankings);
  const startSitFiltered = removeHero(startSit);
  const adviceFiltered = removeHero(advice);
  const dfsFiltered = removeHero(dfs);
  const waiversFiltered = removeHero(waivers);
  const injuriesFiltered = removeHero(injuries);

  const showHero = selected === null && hero !== null;

  // Renders a single LoadMoreSection based on the selected filter
  const renderSelected = (k: SectionKey) => {
    switch (k) {
      case "rankings":
        return (
          <>
            <StaticLinksSection initial="rankings_ros" />
            <LoadMoreSection
              title="Rankings"
              sectionKey="rankings"
              initialItems={rankingsFiltered}
              days={DAYS}
            />
          </>
        );
      case "start-sit":
        return (
          <LoadMoreSection
            title="Start/Sit & Sleepers"
            sectionKey="start-sit"
            initialItems={startSitFiltered}
            days={DAYS}
          />
        );
      case "waivers":
        return (
          <LoadMoreSection
            title={`Waiver Wire — ${weekLabel(CURRENT_WEEK)}`}
            sectionKey="waiver-wire"
            initialItems={waiversFiltered}
            days={DAYS}
            week={CURRENT_WEEK}
          />
        );
      case "news":
        return (
          <LoadMoreSection
            title="News & Updates"
            sectionKey="news"
            initialItems={latestFiltered}
            days={DAYS}
          />
        );
      case "dfs":
        return (
          <>
            <StaticLinksSection initial="rankings_ros" />
            <LoadMoreSection
              title="DFS"
              sectionKey="dfs"
              initialItems={dfsFiltered}
              days={DAYS}
            />
          </>
        );
      case "advice":
        return (
          <LoadMoreSection
            title="Advice"
            sectionKey="advice"
            initialItems={adviceFiltered}
            days={DAYS}
          />
        );
      case "injury":
        return (
          <LoadMoreSection
            title="Injuries"
            sectionKey="injury"
            initialItems={injuriesFiltered}
            days={DAYS}
          />
        );
    }
  };

  return (
    <Suspense fallback={null}>
      <main className="mx-auto max-w-[100%] px-2 sm:px-6 lg:px-8 py-6">
        <header className="mb-6 text-center">
          <h1 className="font-extrabold tracking-tight text-black text-5xl sm:text-6xl md:text-7xl">
            The Fantasy Report
          </h1>
        </header>

        {showHero && hero && (
          <div className="mb-8 mx-auto max-w-2xl">
            <Hero
              title={hero.title}
              href={hero.href}
              src={hero.src}
              source={hero.source}
            />
          </div>
        )}

        <div className="flex justify-end px-3 py-2">
          <ImageToggle />
        </div>

        {/* If a filter is active, render a centered single column */}
        {selected ? (
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {renderSelected(selected)}
          </div>
        ) : (
          // 3-column view
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-[1fr_1.25fr_1fr] md:gap-2">
            {/* Left column */}
            <div className="order-2 md:order-1 space-y-4">
              <LoadMoreSection
                title="Rankings"
                sectionKey="rankings"
                initialItems={rankingsFiltered}
              />
              <LoadMoreSection
                title="Start/Sit & Sleepers"
                sectionKey="start-sit"
                initialItems={startSitFiltered}
              />
              <LoadMoreSection
                title={`Waiver Wire — ${weekLabel(CURRENT_WEEK)}`}
                sectionKey="waiver-wire"
                initialItems={waiversFiltered}
                week={CURRENT_WEEK}
              />
            </div>

            {/* Middle column */}
            <div className="order-1 md:order-2 space-y-4">
              <LoadMoreSection
                title="News & Updates"
                sectionKey="news"
                initialItems={latestFiltered}
              />
            </div>

            {/* Right column */}
            <div className="order-3 md:order-3 space-y-4">
              {/* NEW: Static links above DFS */}
              <StaticLinksSection initial="rankings_ros" />

              <LoadMoreSection
                title="DFS"
                sectionKey="dfs"
                initialItems={dfsFiltered}
              />
              <LoadMoreSection
                title="Advice"
                sectionKey="advice"
                initialItems={adviceFiltered}
              />
              <LoadMoreSection
                title="Injuries"
                sectionKey="injury"
                initialItems={injuriesFiltered}
              />
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
