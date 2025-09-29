// app/page.tsx
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

// Runtime hints
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ——— Hero API fetch (manual recent or auto-breaking) ———
type HeroApiHero = { title: string; href: string; src?: string; source: string };
type HeroApiResp = { mode: "manual" | "auto" | "empty"; hero: HeroApiHero | null };

async function fetchCurrentHero(): Promise<HeroApiHero | null> {
  try {
    const res = await fetch("/api/hero/current", { method: "GET", cache: "no-store" });
    if (!res.ok) return null;
    const j: HeroApiResp = await res.json();
    return j.hero ?? null;
  } catch {
    return null;
  }
}

// Drop utilities that work by id *or* href (canonical or raw)
const dropById =
  (id: number | null) =>
  <T extends { id: number }>(arr: T[]) =>
    id ? arr.filter((x) => x.id !== id) : arr;

const dropByHref =
  (href: string | null) =>
  <T extends { url?: string | null; canonical_url?: string | null }>(arr: T[]) =>
    href ? arr.filter((x) => (x.canonical_url ?? x.url ?? "") !== href) : arr;


const SITE_ORIGIN = "https://www.thefantasyreport.com";


/* ───────────────────────── Section keys ───────────────────────── */
const SECTION_KEYS = [
  "waivers",
  "rankings",
  "start-sit",
  "injury",
  "dfs",
  "advice",
  "news",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
const isSectionKey = (v: string): v is SectionKey =>
  (SECTION_KEYS as readonly string[]).includes(v);

/* ───────────────────────── Title helpers ───────────────────────── */

/** Keep the template from BASE if present; otherwise return a plain string. */
function mergeTitle(
  base: Metadata["title"],
  def: string
): string | { default: string; template?: string } {
  if (
    base &&
    typeof base === "object" &&
    "template" in base &&
    typeof (base as any).template === "string"
  ) {
    return { default: def, template: (base as any).template as string };
  }
  return def;
}

/** Human title used for <title>/OG/Twitter */
function titleForHome(
  selectedSection: SectionKey | null,
  provider: string | null,
  weekLabelStr: string
): string {
  if (selectedSection === "waivers") return `Waiver Wire — ${weekLabelStr}`;
  if (selectedSection === "start-sit") return "Start/Sit & Sleepers";
  if (selectedSection === "rankings") return "Rankings";
  if (selectedSection === "injury") return "Injuries";
  if (selectedSection === "dfs") return "DFS";
  if (selectedSection === "advice") return "Advice";
  if (selectedSection === "news") return "Headlines";
  if (provider) return `Articles from ${provider}`;
  return "Fantasy Football Headlines";
}

/** Canonical path for the current filters */
function canonicalPath(
  selectedSection: SectionKey | null,
  provider: string | null
): string {
  const params = new URLSearchParams();
  if (selectedSection) params.set("section", selectedSection);
  if (provider) params.set("provider", provider);
  const suffix = params.toString();
  return suffix ? `/?${suffix}` : "/";
}

/* ───────────────────────── Waiver week helpers ───────────────────────── */

const TZ = "America/Chicago";
/** Set this to the Monday that starts Week 1 (YYYY-MM-DD). */
const WAIVER_WEEK1_MONDAY =
  process.env.NEXT_PUBLIC_WAIVER_WEEK1_MONDAY ?? "2025-09-01";

type YMD = { y: number; m: number; d: number };
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
function dayCountUTC({ y, m, d }: YMD): number {
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

const CURRENT_WEEK = computeWaiverWeek(WAIVER_WEEK1_MONDAY);
const weekLabel = (wk: number) => `Week ${wk}`;

/* ───────────────────────── Mapping/helpers ───────────────────────── */

const SPORT = "nfl";
const DEFAULT_DAYS = 45;

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

/* ───────────────────────── Metadata (per filters) ───────────────────────── */

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;

  const rawSection = (Array.isArray(sp.section) ? sp.section[0] : sp.section) ?? "";
  const sectionParam = rawSection.toLowerCase().trim();
  const selectedSection: SectionKey | null = isSectionKey(sectionParam) ? sectionParam : null;

  const provider = parseProviderParam(sp.provider);

  const title = titleForHome(
    selectedSection,
    provider,
    weekLabel(CURRENT_WEEK)
  );

  const canonical = canonicalPath(selectedSection, provider); // e.g. "/?section=news"

  // We don't set images here; layout.tsx already sets site-wide OG/Twitter images.
  return {
    title,
    alternates: { canonical },          // relative; resolved using metadataBase from layout.tsx
    openGraph: {
      title,
      url: canonical,                    // relative is fine with metadataBase
    },
    twitter: {
      title,
      // card/images are inherited from layout.tsx
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

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;

  // Optional filters
  const rawSection = (Array.isArray(sp.section) ? sp.section[0] : sp.section) ?? "";
  const sectionParam = rawSection.toLowerCase().trim();
  const selectedSection: SectionKey | null = isSectionKey(sectionParam)
    ? sectionParam
    : null;

  const selectedProvider = parseProviderParam(sp.provider);
  const selectedSourceId =
    Number(Array.isArray(sp.sourceId) ? sp.sourceId[0] : sp.sourceId) || null;

  const isFilterMode = !!selectedSourceId || !!selectedProvider;

  // Wider window + bigger limits when filtering
  const days = isFilterMode ? 365 : DEFAULT_DAYS;
  const limits = {
    limitNews: isFilterMode ? 150 : 12,
    limitRankings: isFilterMode ? 60 : 10,
    limitStartSit: isFilterMode ? 60 : 12,
    limitAdvice: isFilterMode ? 60 : 10,
    limitDFS: isFilterMode ? 60 : 10,
    limitWaivers: isFilterMode ? 60 : 10,
    limitInjuries: isFilterMode ? 60 : 10,
    limitHero: isFilterMode ? 24 : 12,
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

// Pick hero via API (manual/auto). If none, fallback to first news with image.
const apiHero = await fetchCurrentHero();

let heroRow: Article | null = null;
let hero: HeroData | null = null;

if (apiHero) {
  hero = {
    title: apiHero.title,
    href: apiHero.href,
    src: apiHero.src ?? getSafeImageUrl(null) ?? FALLBACK,
    source: apiHero.source,
  };
} else {
  // Fallback: take first news item with a good image (your old behavior)
  heroRow = latest.find(hasRealImage) ?? null;
  hero = heroRow
    ? {
        title: heroRow.title,
        href: heroRow.canonical_url ?? heroRow.url ?? `/go/${heroRow.id}`,
        src: getSafeImageUrl(heroRow.image_url)!,
        source: heroRow.source ?? "",
      }
    : null;
}

// Remove hero from lists.
// If we used API hero, drop by href; if we used fallback news row, drop by id.
const latestFiltered   = apiHero ? dropByHref(hero?.href ?? null)(latest)   : dropById(heroRow?.id ?? null)(latest);
const rankingsFiltered = apiHero ? dropByHref(hero?.href ?? null)(rankings) : dropById(heroRow?.id ?? null)(rankings);
const startSitFiltered = apiHero ? dropByHref(hero?.href ?? null)(startSit) : dropById(heroRow?.id ?? null)(startSit);
const adviceFiltered   = apiHero ? dropByHref(hero?.href ?? null)(advice)   : dropById(heroRow?.id ?? null)(advice);
const dfsFiltered      = apiHero ? dropByHref(hero?.href ?? null)(dfs)      : dropById(heroRow?.id ?? null)(dfs);
const waiversFiltered  = apiHero ? dropByHref(hero?.href ?? null)(waivers)  : dropById(heroRow?.id ?? null)(waivers);
const injuriesFiltered = apiHero ? dropByHref(hero?.href ?? null)(injuries) : dropById(heroRow?.id ?? null)(injuries);

const showHero = selectedSection === null && hero !== null;


  /* JSON-LD */
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

  return (
    <Suspense fallback={null}>
      <main className="mx-auto max-w-[100%] px-0 sm:px-4 lg:px-8 pt-2 pb-4">
        <JsonLd json={baseLd} />
        {sectionLd ? <JsonLd json={sectionLd} /> : null}

        <header className="mt-0 mb-3">
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
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {/* Single section view */}
            {(() => {
              switch (selectedSection) {
                case "rankings":
                  return (
                    <LoadMoreSection
                      title="Rankings"
                      sectionKey="rankings"
                      initialItems={rankingsFiltered}
                      days={days}
                      sourceId={selectedSourceId ?? undefined}
                      provider={selectedProvider ?? undefined}
                    />
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
                    <LoadMoreSection
                      title="DFS"
                      sectionKey="dfs"
                      initialItems={dfsFiltered}
                      days={days}
                      sourceId={selectedSourceId ?? undefined}
                      provider={selectedProvider ?? undefined}
                    />
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
            })()}
          </div>
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
