// Build cache buster: 03/28/2026, 18:14:39 - FRESH CONTENT FIX
import type { Metadata } from "next";
import BetaHero from "@/components/beta/BetaHero";
import BetaNav from "@/components/beta/BetaNav";
import BetaSection from "@/components/beta/BetaSection";
import BetaFeed from "@/components/beta/BetaFeed";
import BetaTrending from "@/components/beta/BetaTrending";
import BetaLoadMoreSection from "@/components/beta/BetaLoadMoreSection";
import BetaDraftSection from "@/components/beta/BetaDraftSection";
import FilterBanner from "@/components/beta/FilterBanner";
import LatestTransactions from "@/components/beta/LatestTransactions";
import { getTeamById, filterArticlesByTeam } from "@/lib/teams";
import { buildTrendingClusters, getCurrentSeasonMode } from "@/lib/trending";
import { scoreAndSortArticles, balanceFeed, selectClusterRepresentatives, globalDedupe } from "@/lib/feedScore";
import { getTeamRoster, filterArticlesByTeamWithRoster } from "@/lib/teams-server";

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
  description: "Premium NFL news hub. Curated fantasy football news, rankings, and analysis from the best sources.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "The Fantasy Report",
    description: "The best NFL news site. Latest NFL and fantasy football news, rankings, and analysis - organized, fast, easy to scan.",
    url: "/",
  },
};


function cleanTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

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
    title: cleanTitle(a.title || ""),
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
  "nfl-draft",
  "free-agency",
] as const;

type SectionKey = (typeof SECTION_KEYS)[number];

type SeasonMode = "regular" | "off-season" | "preseason";

const inRange = (d: Date, start: { month: number; day: number }, end: { month: number; day: number }) => {
  const year = d.getFullYear();
  const s = new Date(year, start.month - 1, start.day);
  const e = new Date(year, end.month - 1, end.day);
  return d >= s && d <= e;
};

function getSeasonMode(now: Date): SeasonMode {
  // Off-Season: Feb 1 through end of NFL Draft (late April/early May)
  if (inRange(now, { month: 2, day: 1 }, { month: 5, day: 10 })) return "off-season";
  
  // Preseason: Late July through Week 1 kickoff (early Sept)
  if (inRange(now, { month: 7, day: 25 }, { month: 9, day: 10 })) return "preseason";
  
  // Regular Season: everything else (Sept-Jan + playoffs)
  return "regular";
}



// Local testing override - set environment variable to test different modes
// Example: TEST_SEASON_MODE=draft npm run dev
function getEffectiveSeasonMode(now: Date): SeasonMode {
  const override = process.env.TEST_SEASON_MODE as SeasonMode | undefined;
  if (override && ['regular', 'off-season', 'preseason'].includes(override)) {
    console.log(`[Season Override] Using TEST_SEASON_MODE=${override}`);
    return override;
  }
  return getSeasonMode(now);
}const FREE_AGENCY_RX =
  /\b(free\s+agency|sign(?:ed|ing)?|re-?sign(?:ed|ing)?|trade(?:d|s)?|cut|release(?:d)?|cap\s+hit|contract|extension|tagged|franchise\s+tag|waived|claimed|restructure|restructured|interest|visit(?:ed|ing)?|meeting|expected\s+to|agree(?:s|d|ment)?|terms|deal|joining|headed\s+to|finalizing)/i;

const DRAFT_RX =
  /\b(mock\s+draft|nfl\s+draft|prospect|prospects?|combine|big\s+board|draft\s+class|rookie|landing\s+spot|scouting|draft|senior\s+bowl|pro\s+day|team\s+needs?|team\s+fits?|draft\s+buzz|draft\s+rumors?|stock\s+up|stock\s+down)\b/i;

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
  
  // Determine season mode for time windows and limits
  const seasonMode = getEffectiveSeasonMode(new Date());
  const isOffseason = seasonMode === 'off-season';

  const data = await getHomeData({
    sport: "nfl",
    days: isOffseason ? 90 : 60,              // 90 days offseason, 60 regular
    week,
    limitNews: isOffseason ? 200 : 150,       // 200 offseason, 150 regular
    limitRankings: 100,                        // Increased from 80
    limitStartSit: 80,
    limitAdvice: 100,                          // Increased from 80
    limitDFS: 80,                              // Increased from 60
    limitWaivers: 80,
    limitInjuries: 80,                         // Increased from 60
    limitHero: 50,
    maxAgeHours: isOffseason ? 168 : 72,      // 7 days offseason, 3 days regular         // Increased from 12
    selectedSection:
      selectedSection === "waivers" ? "waiver-wire" : selectedSection === "injury" ? "injury" : selectedSection,
  });

  const latest = data.items.latest.map(mapRow);
  const rankings = data.items.rankings.map(mapRow);
  const startSit = data.items.startSit.map(mapRow);
  const advice = data.items.advice.map(mapRow);
  const dfs = data.items.dfs.map(mapRow);
  
  // Filter DFS to NFL-only in offseason (prevent NBA/MLB content)
  const dfsFiltered = isOffseason
    ? dfs.filter(a => {
        const hay = `${a.title ?? ""} ${a.url ?? ""}`;
        return /\b(nfl|football|best\s+ball)\b/i.test(hay) && !/\b(nba|mlb|baseball|basketball)\b/i.test(hay);
      })
    : dfs;
  const waivers = data.items.waivers.map(mapRow);
  const injuries = data.items.injuries.map(mapRow);

  // Hero will be selected after trending clusters are built

  // Temporary: use first article as hero candidate for removal
  const tempHeroId = (latest.find(hasRealImage) ?? latest[0])?.id ?? null;

  const latestNoHero = removeHero(latest, tempHeroId);
  const rankingsNoHero = removeHero(rankings, tempHeroId);
  const startSitNoHero = removeHero(startSit, tempHeroId);
  const adviceNoHero = removeHero(advice, tempHeroId);
  const dfsNoHero = removeHero(dfsFiltered, tempHeroId);
  const waiversNoHero = removeHero(waivers, tempHeroId);
  const injuriesNoHero = removeHero(injuries, tempHeroId);

  // Build intelligent scored feed
    // Get season mode for trending + feed scoring
  const effectiveSeasonMode = getCurrentSeasonMode();

  const allArticles = uniqueArticles(
    latestNoHero,
    rankingsNoHero,
    adviceNoHero,
    startSitNoHero,
    waiversNoHero,
    injuriesNoHero,
    dfsNoHero
  );
  
  const scoredArticles = scoreAndSortArticles(allArticles, effectiveSeasonMode);

  // Build server-side trending clusters FIRST
  const trendingArticles = uniqueArticles(
    latestNoHero,
    rankingsNoHero,
    adviceNoHero,
    startSitNoHero,
    dfsNoHero,
    waiversNoHero,
    injuriesNoHero,
  ).slice(0, 100);
  console.log('📈 TRENDING INPUT:', {
    latestCount: latestNoHero.length,
    rankingsCount: rankingsNoHero.length,
    totalTrendingArticles: trendingArticles.length,
    sampleTitles: trendingArticles.slice(0, 3).map(a => a.title?.substring(0, 50))
  });
  
  const trendingClusters = buildTrendingClusters(trendingArticles, effectiveSeasonMode, 8);
  
  const topClusterArticleIds = trendingClusters[0]?.articleIds || [];
  const topClusterArticles = allArticles.filter(a => topClusterArticleIds.includes(a.id)).filter(hasRealImage);
  const heroPool = [...topClusterArticles, ...latest.slice(0, 10), ...rankings.slice(0, 5)];
  const scoredHeroPool = scoreAndSortArticles(heroPool, effectiveSeasonMode);
  const hero = scoredHeroPool.find(hasRealImage) ?? latest.find(hasRealImage) ?? latest[0] ?? rankings[0];
  const heroId = hero?.id ?? null;
  const clusterRepresentatives = selectClusterRepresentatives(trendingClusters, scoredArticles);
  const clusterIds = new Set(clusterRepresentatives.map(a => a.id));
  const nonClusterArticles = scoredArticles.filter(a => !clusterIds.has(a.id));
  const feedPool = [...clusterRepresentatives, ...nonClusterArticles];
  const feed = balanceFeed(feedPool, effectiveSeasonMode, 14);
  
  // CRITICAL FIX: Remove hero from feed since hero was selected AFTER allArticles were built
  // The tempHeroId used earlier may differ from the final heroId
  const feedWithoutHero = feed.filter(a => a.id !== heroId);
  const usedInFeed = new Set<number>(feed.map(a => a.id));
  usedInFeed.add(heroId || 0);

  const freeAgencyItems = latest.filter((a) => {
    const hay = `${a.title ?? ""} ${a.canonical_url ?? a.url ?? ""}`;
    return FREE_AGENCY_RX.test(hay);
  });
  console.log('🔍 FREE AGENCY DEBUG:', {
    latestCount: latest.length,
    freeAgencyCount: freeAgencyItems.length,
    sampleTitles: freeAgencyItems.slice(0, 3).map(a => a.title?.substring(0, 50))
  });

  const draftItems = latest.filter((a) => {
    const hay = `${a.title ?? ""} ${a.canonical_url ?? a.url ?? ""}`;
    return DRAFT_RX.test(hay);
  });

  
  // Apply team filter if selected
  let filteredFeed: Article[] = feedWithoutHero;
  let filteredLatest: Article[] = latestNoHero;
  let filteredRankings: Article[] = rankingsNoHero;
  let filteredStartSit: Article[] = startSitNoHero;
  let filteredAdvice: Article[] = adviceNoHero;
  let filteredDfs: Article[] = dfsNoHero;
  let filteredWaivers: Article[] = waiversNoHero;
  let filteredInjuries: Article[] = injuriesNoHero;

  // RECALCULATE usedInFeed based on displayed feed items (not all 14)
  const displayedFeed = filteredFeed.slice(0, 6);
  const actualUsedInFeed = new Set<number>(displayedFeed.map(a => a.id));
  if (heroId) actualUsedInFeed.add(heroId);

  // Dedupe free agency and draft items against displayed feed
  const uniqueFreeAgency = freeAgencyItems.filter(a => !actualUsedInFeed.has(a.id));
  const uniqueDraft = draftItems.filter(a => !actualUsedInFeed.has(a.id));


  let totalFilteredCount = 0;

  if (selectedTeam) {
    filteredFeed = filterArticlesByTeam(feedWithoutHero, selectedTeam.id) as Article[];
    filteredLatest = filterArticlesByTeam(latestNoHero, selectedTeam.id) as Article[];
    filteredRankings = filterArticlesByTeam(rankingsNoHero, selectedTeam.id) as Article[];
    filteredStartSit = filterArticlesByTeam(startSitNoHero, selectedTeam.id) as Article[];
    filteredAdvice = filterArticlesByTeam(adviceNoHero, selectedTeam.id) as Article[];
    filteredDfs = filterArticlesByTeam(dfsNoHero, selectedTeam.id) as Article[];
    filteredWaivers = filterArticlesByTeam(waiversNoHero, selectedTeam.id) as Article[];
    filteredInjuries = filterArticlesByTeam(injuriesNoHero, selectedTeam.id) as Article[];
    
    totalFilteredCount = filteredFeed.length + filteredLatest.length + filteredRankings.length + 
                        filteredStartSit.length + filteredAdvice.length + filteredDfs.length ;
  }

  // Deduplicate articles across all sections
  // Start with articles already used in hero + feed
  const seenIds = new Set<number>(actualUsedInFeed);
  
  // Deduplicate each section in order
  const uniqueLatest = filteredLatest.slice(0, 20).filter(a => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });
  
  // Track feed for other sections

  
  const uniqueRankings = filteredRankings.filter(a => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });
  
  const uniqueStartSit = filteredStartSit.filter(a => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });
  
  const uniqueAdvice = filteredAdvice.filter(a => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });
  
  const uniqueDfs = filteredDfs.filter(a => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });
  
  const uniqueInjuries = filteredInjuries.filter(a => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });
  
  const uniqueWaivers = filteredWaivers.filter(a => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });



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
                  Premium NFL news hub.
                </h1>
                <p className="max-w-2xl text-sm text-zinc-600">
                  We curate the most important fantasy content across the web and send you straight to the source.</p>
              </div>
              <BetaNav seasonMode={seasonMode} />
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
              initialItems={uniqueLatest}
              pageSize={12}
              initialDisplay={2}
            />

            <div className="w-full">{/* Ensure Latest Transactions stays in left column */}

              <LatestTransactions teamId={selectedTeam?.id} />

            </div>
          </section>


          <aside className="space-y-6">
            <BetaTrending clusters={trendingClusters} />

            <BetaLoadMoreSection
              title="Rankings & tiers"
              subtitle="Top recent rankings and rest-of-season insight"
              sectionKey="rankings"
              initialItems={uniqueRankings}
              pageSize={10}
              initialDisplay={4}
            />

            {seasonMode === "regular" || seasonMode === "preseason" ? (
            <BetaLoadMoreSection
              title="Start/Sit & Advice"
              subtitle="Lineup answers, sleepers, and strategy"
              sectionKey="start-sit"
              initialItems={uniqueArticles(uniqueStartSit, uniqueAdvice)}
              pageSize={10}
              initialDisplay={4}
            />
            ) : null}

            {seasonMode === "off-season" ? (
            <BetaDraftSection articles={draftItems.slice(0, 20)} />
            ) : null}

            </aside>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {seasonMode === "off-season" ? (
            <BetaLoadMoreSection
              title="Free Agency Tracker"
              subtitle="Signings, trades, and roster moves with fantasy impact"
              sectionKey="news"
              initialItems={selectedTeam ? filterArticlesByTeam(removeHero(uniqueFreeAgency, tempHeroId), selectedTeam.id) as Article[] : removeHero(uniqueFreeAgency, tempHeroId)}
              pageSize={10}
              initialDisplay={4}
            />
          ) : seasonMode === "preseason" ? (
            <BetaLoadMoreSection
              title="Draft Center"
              subtitle="Mock drafts, prospects, and rookie outlooks"
              sectionKey="news"
              initialItems={selectedTeam ? filterArticlesByTeam(removeHero(uniqueDraft, tempHeroId), selectedTeam.id) as Article[] : removeHero(uniqueDraft, tempHeroId)}
              pageSize={10}
              initialDisplay={4}
            />
          ) : (
            <BetaLoadMoreSection
              title={`Waiver wire · Week ${week}`}
              subtitle="Priority adds and stash targets"
              sectionKey="waiver-wire"
              initialItems={uniqueWaivers}
              pageSize={10}
              initialDisplay={4}
              week={week}
            />
          )}

          <BetaLoadMoreSection
            title="DFS"
            subtitle="Slate breakdowns and optimizer tools"
            sectionKey="dfs"
            initialItems={uniqueDfs}
            pageSize={10}
            initialDisplay={4}
          />

          <BetaLoadMoreSection
            title="Injuries"
            subtitle="Status reports and return timelines"
            sectionKey="injury"
            initialItems={uniqueInjuries}
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
