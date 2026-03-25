// Build cache buster: 2026-03-24 23:57:27
import type { Metadata } from "next";
import BetaHero from "@/components/beta/BetaHero";
import BetaNav from "@/components/beta/BetaNav";
import BetaSection from "@/components/beta/BetaSection";
import BetaFeed from "@/components/beta/BetaFeed";
import BetaTrending from "@/components/beta/BetaTrending";
import BetaLoadMoreSection from "@/components/beta/BetaLoadMoreSection";
import FilterBanner from "@/components/beta/FilterBanner";
import LatestTransactions from "@/components/beta/LatestTransactions";
import { getTeamById, filterArticlesByTeam } from "@/lib/teams";

import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK, isLikelyFavicon } from "@/lib/images";
import { getHomeData, type DbRow } from "@/lib/HomeData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TZ = "America/Chicago";
const WAIVER_WEEK1_MONDAY = process.env.NEXT_PUBLIC_WAIVER_WEEK1_MONDAY ?? "2025-09-01";

export const metadata: Metadata = {
  title: "The Fantasy Report",
  description: "A premium hub for fantasy football news, rankings, and advice with direct links to the source.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "The Fantasy Report",
    description: "A premium hub for fantasy football news, rankings, and advice with direct links to the source.",
    url: "/",
  },
};

const mapRow = (a: DbRow): Article => {
  const str = (k: keyof DbRow): string | null =>
    k in a && typeof a[k] === "string" ? (a[k] as string) : null;
  const num = (k: keyof DbRow): number | null => {
    if (!(k in a)) return null;
    const v = a[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const strArr = (k: keyof DbRow): string[] | null => {
    const v = k in a ? (a[k] as unknown) : null;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : null;
  };

  return {
    id: a.id,
    title: a.title,
    url: a.url,
    canonical_url: a.canonical_url,
    domain: a.domain,
    image_url: a.image_url ?? null,
    published_at: a.published_at ?? null,
    source: a.source,
    primary_topic: str("primary_topic"),
    secondary_topic: str("secondary_topic"),
    topics: strArr("topics"),
    week: num("week"),
    summary: str("summary"),
    fantasy_impact_label: str("fantasy_impact_label"),
    fantasy_impact_confidence: num("fantasy_impact_confidence"),
  };
};

function getYMDInZone(d: Date, tz: string): { y: number; m: number; d: number } {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const [y, m, day] = s.split("-").map((n) => Number(n));
  return { y, m, d: day };
}

function dayCountUTC({ y, m, d }: { y: number; m: number; d: number }): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function computeWaiverWeek(week1MondayYMD: string, now = new Date()): number {
  const [sy, sm, sd] = week1MondayYMD.split("-").map(Number);
  if (!sy || !sm || !sd) return 1;
  const start = dayCountUTC({ y: sy, m: sm, d: sd });
  const today = dayCountUTC(getYMDInZone(now, TZ));
  const weeks = Math.floor((today - start) / 7) + 1;
  return Math.max(1, weeks);
}

function hasRealImage(a: Article) {
  const u = getSafeImageUrl(a.image_url);
  return !!u && u !== FALLBACK && !isLikelyFavicon(u);
}

function uniqueArticles(...lists: Article[][]): Article[] {
  const seen = new Set<number>();
  const out: Article[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function removeHero(items: Article[], heroId?: number | null): Article[] {
  if (!heroId) return items;
  return items.filter((a) => a.id !== heroId);
}

const SECTION_KEYS = [
  "news",
  "rankings",
  "start-sit",
  "waivers",
  "advice",
  "dfs",
  "injury",
] as const;

type SectionKey = (typeof SECTION_KEYS)[number];

type SeasonMode = "regular" | "free-agency" | "draft";

const inRange = (d: Date, start: { month: number; day: number }, end: { month: number; day: number }) => {
  const year = d.getFullYear();
  const s = new Date(year, start.month - 1, start.day);
  const e = new Date(year, end.month - 1, end.day);
  return d >= s && d <= e;
};

function getSeasonMode(now: Date): SeasonMode {
  if (inRange(now, { month: 3, day: 1 }, { month: 4, day: 20 })) return "free-agency";
  if (inRange(now, { month: 4, day: 21 }, { month: 5, day: 20 })) return "draft";
  return "regular";
}

const FREE_AGENCY_RX =
  /\b(free\s+agency|sign(?:ed|ing)?|re-?sign(?:ed|ing)?|trade(?:d|s)?|cut|release(?:d)?|cap\s+hit|contract|extension|tagged|franchise\s+tag|waived|claimed|restructure|restructured)\b/i;

const DRAFT_RX =
  /\b(mock\s+draft|prospect|combine|big\s+board|draft\s+class|rookie|landing\s+spot|scouting|draft|senior\s+bowl)\b/i;

function toSectionKey(raw: string | string[] | undefined): SectionKey | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const key = v.toLowerCase().trim();
  return (SECTION_KEYS as readonly string[]).includes(key) ? (key as SectionKey) : null;
}


export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // Team filtering
  const teamId = typeof sp.team === "string" ? sp.team : null;
  const selectedTeam = teamId ? getTeamById(teamId) : null;
  const selectedSection = toSectionKey(sp.section);
  const week = computeWaiverWeek(WAIVER_WEEK1_MONDAY);

  const data = await getHomeData({
    sport: "nfl",
    days: 60,
    week,
    limitNews: 18,
    limitRankings: 16,
    limitStartSit: 16,
    limitAdvice: 16,
    limitDFS: 12,
    limitWaivers: 16,
    limitInjuries: 12,
    limitHero: 12,
    selectedSection:
      selectedSection === "waivers" ? "waiver-wire" : selectedSection === "injury" ? "injury" : selectedSection,
  });

  const latest = data.items.latest.map(mapRow);
  const rankings = data.items.rankings.map(mapRow);
  const startSit = data.items.startSit.map(mapRow);
  const advice = data.items.advice.map(mapRow);
  const dfs = data.items.dfs.map(mapRow);
  const waivers = data.items.waivers.map(mapRow);
  const injuries = data.items.injuries.map(mapRow);

  const hero = latest.find(hasRealImage) ?? latest[0] ?? rankings[0] ?? startSit[0];
  const heroId = hero?.id ?? null;

  const latestNoHero = removeHero(latest, heroId);
  const rankingsNoHero = removeHero(rankings, heroId);
  const startSitNoHero = removeHero(startSit, heroId);
  const adviceNoHero = removeHero(advice, heroId);
  const dfsNoHero = removeHero(dfs, heroId);
  const waiversNoHero = removeHero(waivers, heroId);
  const injuriesNoHero = removeHero(injuries, heroId);

  const feed = uniqueArticles(latestNoHero, rankingsNoHero, adviceNoHero, startSitNoHero).slice(0, 14);
  const trendingPool = uniqueArticles(
    latestNoHero,
    rankingsNoHero,
    adviceNoHero,
    startSitNoHero,
    waiversNoHero,
    dfsNoHero,
    injuriesNoHero
  );

  const seasonMode = getSeasonMode(new Date());
  const freeAgencyItems = latest.filter((a) => {
    const hay = `${a.title ?? ""} ${a.canonical_url ?? a.url ?? ""}`;
    return FREE_AGENCY_RX.test(hay);
  });

  const draftItems = latest.filter((a) => {
    const hay = `${a.title ?? ""} ${a.canonical_url ?? a.url ?? ""}`;
    return DRAFT_RX.test(hay);
  });

  
  // Apply team filter if selected
  let filteredFeed: Article[] = feed;
  let filteredLatest: Article[] = latestNoHero;
  let filteredRankings: Article[] = rankingsNoHero;
  let filteredStartSit: Article[] = startSitNoHero;
  let filteredAdvice: Article[] = adviceNoHero;
  let filteredDfs: Article[] = dfsNoHero;
  let filteredWaivers: Article[] = waiversNoHero;
  let filteredInjuries: Article[] = injuriesNoHero;
  let totalFilteredCount = 0;

  if (selectedTeam) {
    filteredFeed = filterArticlesByTeam(feed, selectedTeam.id) as Article[];
    filteredLatest = filterArticlesByTeam(latestNoHero, selectedTeam.id) as Article[];
    filteredRankings = filterArticlesByTeam(rankingsNoHero, selectedTeam.id) as Article[];
    filteredStartSit = filterArticlesByTeam(startSitNoHero, selectedTeam.id) as Article[];
    filteredAdvice = filterArticlesByTeam(adviceNoHero, selectedTeam.id) as Article[];
    filteredDfs = filterArticlesByTeam(dfsNoHero, selectedTeam.id) as Article[];
    filteredWaivers = filterArticlesByTeam(waiversNoHero, selectedTeam.id) as Article[];
    filteredInjuries = filterArticlesByTeam(injuriesNoHero, selectedTeam.id) as Article[];
    
    totalFilteredCount = filteredFeed.length + filteredLatest.length + filteredRankings.length + 
                        filteredStartSit.length + filteredAdvice.length + filteredDfs.length + 
                        filteredWaivers.length + filteredInjuries.length;
  }



  return (
    <main className="min-h-screen bg-zinc-50 pb-12">
      <div className="mx-auto max-w-[88rem] px-2 pt-6 sm:px-4 lg:px-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-emerald-700">
              The Fantasy Report
            </p>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                  Your premium hub for fantasy football headlines, rankings, and advice.
                </h1>
                <p className="max-w-2xl text-sm text-zinc-600">
                  We curate the most important fantasy content across the web and send you straight to the source â€”
                  fast, modern, and built for repeat visits.
                </p>
              </div>
              <BetaNav />
            </div>
          </div>

          {hero ? <BetaHero article={hero} /> : null}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <section className="space-y-6">
            <BetaSection
              title="Curated feed"
              subtitle="The highest-value links right now"
              action={<span className="text-xs uppercase tracking-wide">Updated live</span>}
            >
              <BetaFeed articles={filteredFeed.slice(0, 6)} />
            </BetaSection>

            <BetaLoadMoreSection
              title="Latest news"
              subtitle="Breaking updates across the fantasy landscape"
              sectionKey="news"
              initialItems={filteredLatest}
              pageSize={12}
              initialDisplay={2}
            />

            <div className="w-full">{/* Ensure Latest Transactions stays in left column */}

              <LatestTransactions teamId={selectedTeam?.id} />

            </div>
          </section>


          <aside className="space-y-6">
            <BetaTrending articles={trendingPool} />

            <BetaLoadMoreSection
              title="Rankings & tiers"
              subtitle="Top recent rankings and rest-of-season insight"
              sectionKey="rankings"
              initialItems={filteredRankings}
              pageSize={10}
              initialDisplay={4}
            />

            <BetaLoadMoreSection
              title="Start/Sit & Advice"
              subtitle="Lineup answers, sleepers, and strategy"
              sectionKey="start-sit"
              initialItems={uniqueArticles(filteredStartSit, filteredAdvice)}
              pageSize={10}
              initialDisplay={4}
            />

            <BetaLoadMoreSection
              title="More news"
              subtitle="Quick-hit headlines from around the league"
              sectionKey="news"
              initialItems={filteredLatest.slice(2, 10)}
              pageSize={10}
              initialDisplay={8}
              variant="headlines"
            />
          </aside>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {seasonMode === "free-agency" ? (
            <BetaLoadMoreSection
              title="Free Agency Tracker"
              subtitle="Signings, trades, and roster moves with fantasy impact"
              sectionKey="news"
              initialItems={selectedTeam ? filterArticlesByTeam(removeHero(freeAgencyItems, heroId), selectedTeam.id) as Article[] : removeHero(freeAgencyItems, heroId)}
              pageSize={10}
              initialDisplay={4}
            />
          ) : seasonMode === "draft" ? (
            <BetaLoadMoreSection
              title="Draft Center"
              subtitle="Mock drafts, prospects, and rookie outlooks"
              sectionKey="news"
              initialItems={selectedTeam ? filterArticlesByTeam(removeHero(draftItems, heroId), selectedTeam.id) as Article[] : removeHero(draftItems, heroId)}
              pageSize={10}
              initialDisplay={4}
            />
          ) : (
            <BetaLoadMoreSection
              title={`Waiver wire Â· Week ${week}`}
              subtitle="Priority adds and stash targets"
              sectionKey="waiver-wire"
              initialItems={filteredWaivers}
              pageSize={10}
              initialDisplay={4}
              week={week}
            />
          )}

          <BetaLoadMoreSection
            title="DFS"
            subtitle="Slate breakdowns and optimizer tools"
            sectionKey="dfs"
            initialItems={filteredDfs}
            pageSize={10}
            initialDisplay={4}
          />

          <BetaLoadMoreSection
            title="Injuries"
            subtitle="Status reports and return timelines"
            sectionKey="injury"
            initialItems={filteredInjuries}
            pageSize={10}
            initialDisplay={4}
          />
        </div>

        <div className="mt-10 rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-sm text-zinc-600">
          <p className="font-semibold text-zinc-800">Source-forward by design.</p>
          <p>
            The Fantasy Report is a premium hub that highlights the best fantasy coverage and sends you directly to the
            original publisher. We believe great analysis deserves the click.
          </p>
        </div>
      </div>
    </main>
  );
}

