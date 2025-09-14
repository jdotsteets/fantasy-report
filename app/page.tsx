import { Suspense } from "react";
import type { Metadata } from "next";
import Section from "@/components/Section";
import Hero from "@/components/Hero";
import FantasyLinks from "@/components/FantasyLinks";
import LoadMoreSection from "@/components/LoadMoreSection";
import StaticLinksSection from "@/components/StaticLinksSection";

import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK, isLikelyFavicon } from "@/lib/images";
import { getHomeData, type DbRow } from "@/lib/HomeData";
import { websiteJsonLd, itemListJsonLd } from "@/lib/seo/jsonld";
import { BASE_METADATA } from "./layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ───────────────────────── SEO defaults ───────────────────────── */
const SITE_ORIGIN = "https://thefantasyreport.com";

const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: "The Fantasy Report — Fantasy Football Headlines, Waivers, Rankings",
    template: "%s · The Fantasy Report",
  },
  description:
    "The Fantasy Report curates the best fantasy football content: headlines, waiver wire targets, rankings, start/sit advice, DFS picks, and injury news.",
  openGraph: {
    type: "website",
    url: SITE_ORIGIN,
    siteName: "The Fantasy Report",
    title: "The Fantasy Report — Fantasy Football Headlines, Waivers, Rankings",
    description:
      "Curated fantasy football headlines, waiver wire targets, rankings, start/sit, DFS, and injury updates.",
    images: [
      {
        url: `${SITE_ORIGIN}/og/default.jpg`,
        width: 1200,
        height: 630,
        alt: "The Fantasy Report",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@thefantasyrep", // ← update to your actual handle
    title: "The Fantasy Report — Fantasy Football Headlines, Waivers, Rankings",
    description:
      "Curated fantasy football headlines, waiver wire targets, rankings, start/sit, DFS, and injury updates.",
    images: [`${SITE_ORIGIN}/og/default.jpg`],
  },
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
};

/** Build a human title from selected filters for <title> and OG */
function titleForHome(selectedSection: SectionKey | null, provider: string | null, weekLabelStr: string): string {
  if (selectedSection === "waivers") {
    return `Waiver Wire — ${weekLabelStr}`;
  }
  if (selectedSection === "start-sit") return "Start/Sit & Sleepers";
  if (selectedSection === "rankings") return "Rankings";
  if (selectedSection === "injury") return "Injuries";
  if (selectedSection === "dfs") return "DFS";
  if (selectedSection === "advice") return "Advice";
  if (selectedSection === "news") return "Headlines";
  if (provider) return `Articles from ${provider}`;
  return "Fantasy Football Headlines";
}

/** Build a canonical path for the current filters */
function canonicalPath(selectedSection: SectionKey | null, provider: string | null): string {
  const params = new URLSearchParams();
  if (selectedSection) params.set("section", selectedSection);
  if (provider) params.set("provider", provider);
  const suffix = params.toString();
  return suffix ? `/?${suffix}` : "/";
}

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

// ----- Waiver week (starts on Monday, America/Chicago) -----
const TZ = "America/Chicago";

/**
 * Set this to the Monday that starts Week 1 (YYYY-MM-DD, Chicago local date).
 * You can also put it in .env as NEXT_PUBLIC_WAIVER_WEEK1_MONDAY
 * e.g. 2025 season example: 2025-09-01
 */
const WAIVER_WEEK1_MONDAY =
  process.env.NEXT_PUBLIC_WAIVER_WEEK1_MONDAY ?? "2025-09-01";

type YMD = { y: number; m: number; d: number };

/** Get Y/M/D for a Date *in a specific time zone* (no DST surprises) */
function getYMDInZone(d: Date, tz: string): YMD {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const [y, m, day] = s.split("-").map((n) => Number(n));
  return { y, m, d: day };
}

/** Convert Y/M/D to a day count using UTC-midnight (timezone-agnostic) */
function dayCountUTC({ y, m, d }: YMD): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Waiver “current week”: # of Mondays elapsed since Week 1 Monday, +1 */
function computeWaiverWeek(week1MondayYMD: string, now = new Date()): number {
  const [sy, sm, sd] = week1MondayYMD.split("-").map(Number);
  if (!sy || !sm || !sd) return 1;

  const start = dayCountUTC({ y: sy, m: sm, d: sd });
  const today = dayCountUTC(getYMDInZone(now, TZ));
  const weeks = Math.floor((today - start) / 7) + 1;
  return Math.max(1, weeks);
}

function parseProviderParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const plusFixed = v.replace(/\+/g, " ");
  let decoded = plusFixed;
  try {
    decoded = decodeURIComponent(plusFixed);
  } catch {
    /* ignore */
  }
  const out = decoded.trim();
  return out.length ? out : null;
}

const CURRENT_WAIVER_WEEK = computeWaiverWeek(WAIVER_WEEK1_MONDAY);

const SPORT = "nfl";
const DEFAULT_DAYS = 45;
const CURRENT_WEEK = computeWaiverWeek(WAIVER_WEEK1_MONDAY);
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

/* ───────────────────────── Metadata for this page (per filters) ───────────────────────── */
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(
  { searchParams }: { searchParams: SP }
): Metadata {
  const sp = searchParams;

  const rawSection = (Array.isArray(sp.section) ? sp.section[0] : sp.section) ?? "";
  const sectionParam = rawSection.toLowerCase().trim();
  const selectedSection: SectionKey | null = isSectionKey(sectionParam) ? sectionParam : null;

  const provider = parseProviderParam(sp.provider);

  const title = titleForHome(selectedSection, provider, weekLabel(CURRENT_WEEK));
  const canonical = canonicalPath(selectedSection, provider);

  return {
    // start from your defaults
    ...BASE_METADATA,

    // override title (keep template from base if present)

    // keep base alternates, override canonical
    alternates: {
      ...(BASE_METADATA.alternates ?? {}),
      canonical,
    },

    // keep base OG, override dynamic fields
    openGraph: {
      ...(BASE_METADATA.openGraph ?? {}),
      title,
      url: `${SITE_ORIGIN}${canonical}`,
    },

    // keep base Twitter, override dynamic fields
    twitter: {
      ...(BASE_METADATA.twitter ?? {}),
      title,
    },
  };
}


/* ───────────────────────── JSON-LD helper ───────────────────────── */
function JsonLd({ json }: { json: unknown }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}

/* ───────────────────────── Page ───────────────────────── */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;

  // optional section and source filters
  const rawSection = (Array.isArray(sp.section) ? sp.section[0] : sp.section) ?? "";
  const sectionParam = rawSection.toLowerCase().trim();
  const selectedSection: SectionKey | null = isSectionKey(sectionParam) ? sectionParam : null;

  const selectedProvider = parseProviderParam(sp.provider);

  const selectedSourceId =
    Number(Array.isArray(sp.sourceId) ? sp.sourceId[0] : sp.sourceId) || null;
  const isSourceMode = !!selectedSourceId;

  const isFilterMode = !!selectedSourceId || !!selectedProvider;

  // widen window + limits when viewing a single source OR provider
  const days = isFilterMode ? 365 : DEFAULT_DAYS;
  const limits = {
    limitNews:     isFilterMode ? 150 : 12,
    limitRankings: isFilterMode ? 60  : 10,
    limitStartSit: isFilterMode ? 60  : 12,
    limitAdvice:   isFilterMode ? 60  : 10,
    limitDFS:      isFilterMode ? 60  : 10,
    limitWaivers:  isFilterMode ? 60  : 10,
    limitInjuries: isFilterMode ? 60  : 10,
    limitHero:     isFilterMode ? 24  : 12,
  };

  const data: HomePayload = await getHomeData({
    sport: SPORT,
    days,
    week: CURRENT_WEEK,
    sourceId: selectedSourceId ?? undefined,
    provider: selectedProvider ?? undefined,
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

  /* ── JSON-LD payloads ────────────────────────────────────────── */
  // Home / Section JSON-LD
  const baseLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "The Fantasy Report",
    url: SITE_ORIGIN,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_ORIGIN}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  } as const;

  const listForSection = (key: SectionKey, items: Article[]) => ({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: titleForHome(key, selectedProvider, weekLabel(CURRENT_WEEK)),
    itemListElement: items.slice(0, 10).map((a, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      url: a.canonical_url ?? a.url,
      name: a.title,
      image: getSafeImageUrl(a.image_url) || undefined,
    })),
  });

  let sectionLd: unknown = null;
  if (selectedSection === "news") sectionLd = listForSection("news", latestFiltered);
  else if (selectedSection === "rankings") sectionLd = listForSection("rankings", rankingsFiltered);
  else if (selectedSection === "start-sit") sectionLd = listForSection("start-sit", startSitFiltered);
  else if (selectedSection === "advice") sectionLd = listForSection("advice", adviceFiltered);
  else if (selectedSection === "dfs") sectionLd = listForSection("dfs", dfsFiltered);
  else if (selectedSection === "waivers") sectionLd = listForSection("waivers", waiversFiltered);
  else if (selectedSection === "injury") sectionLd = listForSection("injury", injuriesFiltered);

  const renderSelected = (k: SectionKey) => {
    switch (k) {
      case "rankings":
        return (
          <>
            <LoadMoreSection
              title="Rankings"
              sectionKey="rankings"
              initialItems={rankingsFiltered}
              days={days}
              sourceId={selectedSourceId ?? undefined}
              provider={selectedProvider ?? undefined}
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
            provider={selectedProvider ?? undefined}
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
            provider={selectedProvider ?? undefined}
          />
        );
      case "news":
        return (
          <LoadMoreSection
            title="Headlines"
            sectionKey="news"
            initialItems={latestFiltered}
            days={days}
            sourceId={selectedSourceId ?? undefined}
            provider={selectedProvider ?? undefined}
          />
        );
      case "dfs":
        return (
          <>
            <LoadMoreSection
              title="DFS"
              sectionKey="dfs"
              initialItems={dfsFiltered}
              days={days}
              sourceId={selectedSourceId ?? undefined}
              provider={selectedProvider ?? undefined}
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
            provider={selectedProvider ?? undefined}
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
            provider={selectedProvider ?? undefined}
          />
        );
    }
  };

  return (
    <Suspense fallback={null}>
      <main className="mx-auto max-w-[100%] px-0 sm:px-4 lg:px-8 pt-2 pb-4">
        {/* JSON-LD (site) */}
        <JsonLd json={baseLd} />
        {/* JSON-LD (section list) */}
        {sectionLd ? <JsonLd json={sectionLd} /> : null}

        <header className="mt-0 mb-3">
          {/* Full-width masthead (wider than hero), forced single line */}
          <h1
            className="
              mx-auto w-full
              text-center font-extrabold leading-none tracking-[-0.02em] text-zinc-900
              whitespace-nowrap
              text-[clamp(24px,9vw,112px)]
              md:text-[clamp(48px,8vw,120px)]
            "
          >
            The Fantasy Report
          </h1>
        </header>

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
                provider={selectedProvider ?? undefined}
              />
              <LoadMoreSection
                title="Start/Sit & Sleepers"
                sectionKey="start-sit"
                initialItems={startSitFiltered}
                sourceId={selectedSourceId ?? undefined}
                provider={selectedProvider ?? undefined}
              />
              <LoadMoreSection
                title={`Waiver Wire — ${weekLabel(CURRENT_WEEK)}`}
                sectionKey="waiver-wire"
                initialItems={waiversFiltered}
                week={CURRENT_WEEK}
                sourceId={selectedSourceId ?? undefined}
                provider={selectedProvider ?? undefined}
              />
            </div>

            {/* Middle column */}
            <div className="order-1 md:order-2 space-y-4">
              <LoadMoreSection
                title="Headlines"
                sectionKey="news"
                initialItems={latestFiltered}
                sourceId={selectedSourceId ?? undefined}
                provider={selectedProvider ?? undefined}
              />
              <LoadMoreSection
                title="Advice"
                sectionKey="advice"
                initialItems={adviceFiltered}
                sourceId={selectedSourceId ?? undefined}
                provider={selectedProvider ?? undefined}
              />
            </div>

            {/* Right column */}
            <div className="order-3 md:order-3 space-y-4">
              <LoadMoreSection
                title="DFS"
                sectionKey="dfs"
                initialItems={dfsFiltered}
                sourceId={selectedSourceId ?? undefined}
                provider={selectedProvider ?? undefined}
              />

              <LoadMoreSection
                title="Injuries"
                sectionKey="injury"
                initialItems={injuriesFiltered}
                sourceId={selectedSourceId ?? undefined}
                provider={selectedProvider ?? undefined}
              />
              <StaticLinksSection initial="rankings_ros" />
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
