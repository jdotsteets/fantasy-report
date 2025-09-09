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

/* ───────────────────────── Types/consts ───────────────────────── */
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

type HeroData = { title: string; href: string; src: string; source: string };

const SPORT = "nfl";
const DEFAULT_DAYS = 45;
const CURRENT_WEEK = 1;
const weekLabel = (wk: number) => `Week ${wk}`;

const SECTION_KEYS = ["waivers", "rankings", "start-sit", "injury", "dfs", "advice", "news"] as const;
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

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;

  // optional section and source filters
  const rawSection = (Array.isArray(sp.section) ? sp.section[0] : sp.section) ?? "";
  const sectionParam = rawSection.toLowerCase().trim();
  const selectedSection: SectionKey | null = isSectionKey(sectionParam) ? sectionParam : null;

  const selectedSourceId =
    Number(Array.isArray(sp.sourceId) ? sp.sourceId[0] : sp.sourceId) || null;
  const isSourceMode = !!selectedSourceId;

  // widen window + limits when viewing a single source
  const days = isSourceMode ? 365 : DEFAULT_DAYS;
  const limits = {
    limitNews: isSourceMode ? 150 : 20,
    limitRankings: isSourceMode ? 60 : 10,
    limitStartSit: isSourceMode ? 60 : 12,
    limitAdvice: isSourceMode ? 60 : 10,
    limitDFS: isSourceMode ? 60 : 10,
    limitWaivers: isSourceMode ? 60 : 10,
    limitInjuries: isSourceMode ? 60 : 10,
    limitHero: isSourceMode ? 24 : 12,
  };

  const data: HomePayload = await getHomeData({
    sport: SPORT,
    days,
    week: CURRENT_WEEK,                 // only Waiver Wire uses this filter
    sourceId: selectedSourceId ?? undefined,
    ...limits,
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

  const showHero = selectedSection === null && hero !== null;

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
              days={days}
              sourceId={selectedSourceId ?? undefined}
            />
          </>
        );
      case "start-sit":
        return (
          <LoadMoreSection
            title="Start/Sit & Sleepers"
            sectionKey="start-sit"
            initialItems={startSitFiltered}
            days={days}
            sourceId={selectedSourceId ?? undefined}
          />
        );
      case "waivers":
        return (
          <LoadMoreSection
            title={`Waiver Wire — ${weekLabel(CURRENT_WEEK)}`}
            sectionKey="waiver-wire"
            initialItems={waiversFiltered}
            days={days}
            week={CURRENT_WEEK}
            sourceId={selectedSourceId ?? undefined}
          />
        );
      case "news":
        return (
          <LoadMoreSection
            title="News & Updates"
            sectionKey="news"
            initialItems={latestFiltered}
            days={days}
            sourceId={selectedSourceId ?? undefined}
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
              days={days}
              sourceId={selectedSourceId ?? undefined}
            />
          </>
        );
      case "advice":
        return (
          <LoadMoreSection
            title="Advice"
            sectionKey="advice"
            initialItems={adviceFiltered}
            days={days}
            sourceId={selectedSourceId ?? undefined}
          />
        );
      case "injury":
        return (
          <LoadMoreSection
            title="Injuries"
            sectionKey="injury"
            initialItems={injuriesFiltered}
            days={days}
            sourceId={selectedSourceId ?? undefined}
          />
        );
    }
  };

  return (
    <Suspense fallback={null}>
      <main className="mx-auto max-w-[100%] px-2 sm:px-6 lg:px-8 py-6">
        <header className="mb-6 text-center">
          <h1 className="font-extrabold tracking-tight text-black text-5xl sm:text-4xl md:text-4xl">
            The Fantasy Report
          </h1>
        </header>

        <div className="flex justify-end gap-2 px-3 py-2">
          <ImageToggle />
        </div>

        {showHero && hero && (
          <div className="mb-8 mx-auto max-w-2xl">
            <Hero title={hero.title} href={hero.href} src={hero.src} source={hero.source} />
          </div>
        )}

        {selectedSection ? (
          <div className="mx-auto w-full max-w-3xl space-y-4">{renderSelected(selectedSection)}</div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-[1fr_1.25fr_1fr] md:gap-2">
            {/* Left column */}
            <div className="order-2 md:order-1 space-y-4">
              <LoadMoreSection
                title="Rankings"
                sectionKey="rankings"
                initialItems={rankingsFiltered}
                sourceId={selectedSourceId ?? undefined}
              />
              <LoadMoreSection
                title="Start/Sit & Sleepers"
                sectionKey="start-sit"
                initialItems={startSitFiltered}
                sourceId={selectedSourceId ?? undefined}
              />
              <LoadMoreSection
                title={`Waiver Wire — ${weekLabel(CURRENT_WEEK)}`}
                sectionKey="waiver-wire"
                initialItems={waiversFiltered}
                week={CURRENT_WEEK}
                sourceId={selectedSourceId ?? undefined}
              />
            </div>

            {/* Middle column */}
            <div className="order-1 md:order-2 space-y-4">
              <LoadMoreSection
                title="News & Updates"
                sectionKey="news"
                initialItems={latestFiltered}
                sourceId={selectedSourceId ?? undefined}
              />
            </div>

            {/* Right column */}
            <div className="order-3 md:order-3 space-y-4">
              <StaticLinksSection initial="rankings_ros" />
              <LoadMoreSection
                title="DFS"
                sectionKey="dfs"
                initialItems={dfsFiltered}
                sourceId={selectedSourceId ?? undefined}
              />
              <LoadMoreSection
                title="Advice"
                sectionKey="advice"
                initialItems={adviceFiltered}
                sourceId={selectedSourceId ?? undefined}
              />
              <LoadMoreSection
                title="Injuries"
                sectionKey="injury"
                initialItems={injuriesFiltered}
                sourceId={selectedSourceId ?? undefined}
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
