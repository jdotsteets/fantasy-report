// app/page.tsx
import { Suspense } from "react";
import ArticleList from "@/components/ArticleList";
import Section from "@/components/Section";
import Hero from "@/components/Hero";
import FantasyLinks from "@/components/FantasyLinks";
import type { Article } from "@/types/sources";
import { isLikelyFavicon } from "@/lib/images";
import ImageToggle from "@/components/ImageToggle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


type DbRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string;
  image_url: string | null;
  published_at: string | null;
  source: string;
};

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

// ---- Map DB row → Article (only keep fields Article knows about) ----
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

// ---- Week label helper (stub) ----
const CURRENT_WEEK = 1;
function weekLabel(week: number): string {
  return `Week ${week}`;
}

// ---- Service fetch (update limitNews here) ----
async function fetchHome(
  sport: string,
  currentWeek: number
): Promise<HomePayload> {
  const usp = new URLSearchParams({
    sport,
    days: "45",
    week: String(currentWeek),
    limitNews: "60",             // ⬅️ increased from 25 to 60
    limitRankings: "10",
    limitStartSit: "12",
    limitAdvice: "10",
    limitDFS: "10",
    limitWaivers: "10",
    limitInjuries: "10",
    limitHero: "12",
  });
  const url = `/api/home?${usp.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load home");
  return (await res.json()) as HomePayload;
}

type HeroData = {
  title: string;
  href: string;
  src: string;
  source: string;
};

export default async function Page() {
  const sport = "nfl";
  const data = await fetchHome(sport, CURRENT_WEEK);

  // map the API rows to Article[]
  const latest          = data.items.latest.map(mapRow);
  const rankings        = data.items.rankings.map(mapRow);
  const startSit        = data.items.startSit.map(mapRow);
  const advice          = data.items.advice.map(mapRow);
  const dfs             = data.items.dfs.map(mapRow);
  const waivers         = data.items.waivers.map(mapRow);
  const injuries        = data.items.injuries.map(mapRow);

  // hero: pick the latest News & Updates item with a valid image_url
  const hasRealImage = (a: Article): boolean =>
    typeof a.image_url === "string" &&
    a.image_url.length > 0 &&
    !isLikelyFavicon(a.image_url);

  const heroRow = latest.find(hasRealImage) ?? null;

  const hero: HeroData | null = heroRow
    ? {
        title: heroRow.title,
        href: heroRow.canonical_url ?? heroRow.url ?? `/go/${heroRow.id}`,
        src: heroRow.image_url as string,
        source: heroRow.source,
      }
    : null;

  const heroId = heroRow?.id ?? null;
  const dropHero = <T extends { id: number }>(arr: T[]) =>
    heroId ? arr.filter((a) => a.id !== heroId) : arr;

  const latestFiltered   = dropHero(latest);
  const rankingsFiltered = dropHero(rankings);
  const startSitFiltered = dropHero(startSit);
  const adviceFiltered   = dropHero(advice);
  const dfsFiltered      = dropHero(dfs);
  const waiversFiltered  = dropHero(waivers);
  const injuriesFiltered = dropHero(injuries);

 
  return (
    <Suspense fallback={null}>
      <main className="mx-auto max-w-[100%] px-2 sm:px-6 lg:px-8 py-6">
        <header className="mb-6 text-center">
          <h1 className="font-extrabold tracking-tight text-black
            text-5xl sm:text-6xl md:text-7xl">
            The Fantasy Report
          </h1>
        </header>

        {/* Show hero if we have one */}
        {hero ? (
          <div className="mb-8 mx-auto max-w-2xl">
            <Hero
              title={hero.title}
              href={hero.href}
              src={hero.src}
              source={hero.source}
            />
          </div>
        ) : null}

        {/* right-aligned image toggle */}
        <div className="flex justify-end px-3 py-2">
          <ImageToggle />
        </div>

        {/* 3-column layout — slightly tighter gap & wider center column */}
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-[1fr_1.25fr_1fr] md:gap-2">
          {/* Left column */}
          <div className="order-2 md:order-1 space-y-4">
            <Section title="Rankings">
              <ArticleList items={rankingsFiltered} />
            </Section>
            <Section title={`${weekLabel(CURRENT_WEEK)} Start/Sit & Sleepers`}>
              <ArticleList items={startSitFiltered} />
            </Section>
            <Section title="Waiver Wire">
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
      </main>
    </Suspense>
  );
}
