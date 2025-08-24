// app/page.tsx
import { Suspense } from "react"; // 👈 add
import ArticleList from "@/components/ArticleList";
import Section from "@/components/Section";
import Hero from "@/components/Hero";
import FantasyLinks from "@/components/FantasyLinks";
import type { Article } from "@/types/sources";
import { isLikelyFavicon } from "@/lib/images";
import ImageToggle from "@/components/ImageToggle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SectionKey =
  | "news"
  | "rankings"
  | "start-sit"
  | "injury"
  | "dfs"
  | "waivers"
  | "advice";

type Search = { week?: string; section?: SectionKey | string };

type HeroData = {
  title: string;
  href: string;
  src: string;
  source: string;
};

// ---- helper: absolute URL for server-side fetches
function absUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

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

// --- API types / fetcher ---
type ApiArticle = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  image_url: string | null;
  published_at: string | null;
  week: number | null;
  topics: string[] | null;
  source: string;
};
type ApiResp = { items: ApiArticle[]; nextCursor?: string | null };

async function fetchArticles(
  params: Record<string, string | number | null | undefined>
): Promise<Article[]> {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && `${v}`.trim() !== "") usp.set(k, String(v));
  }
  if (!usp.has("days")) usp.set("days", "45");

  const url = absUrl(`/api/articles?${usp.toString()}`);

  const ATTEMPTS = 3;
  const timeoutMs = 8000;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if ((res.status >= 500 || res.status === 429) && attempt < ATTEMPTS) {
          await wait(300 * attempt * attempt);
          continue;
        }
        console.error("API error", res.status, body);
        return [];
      }

      const data = (await res.json().catch(() => null)) as (ApiResp & { error?: string }) | null;
      if (!data) {
        console.error("API error: invalid JSON");
        return [];
      }
      if (data.error) {
        if (attempt < ATTEMPTS) {
          await wait(300 * attempt * attempt);
          continue;
        }
        console.error("API error body:", data.error);
        return [];
      }

      const items = data.items ?? [];
      return items.map((a) => ({
        id: a.id,
        title: a.title,
        url: a.url,
        canonical_url: a.canonical_url,
        domain: a.domain,
        image_url: a.image_url ?? null,
        published_at: a.published_at ?? null,
        week: a.week ?? null,
        topics: a.topics ?? [],
        source: a.source,
      }));
    } catch (err) {
      clearTimeout(timer);
      if (attempt < ATTEMPTS) {
        await wait(300 * attempt * attempt);
        continue;
      }
      console.error("API fetch failed:", err);
      return [];
    }
  }

  return [];
}

export default async function Home(props: { searchParams?: Promise<Search> }) {
  const sp = props.searchParams ? await props.searchParams : {};
  const urlWeek = Number(sp.week);
  const CURRENT_WEEK = Number.isFinite(urlWeek) ? urlWeek : getCurrentNFLWeek();

  const [
    latest,
    rankings,
    startSit,
    advice,
    dfs,
    waivers,
    injuries,
    heroCandidates,
  ] = await Promise.all([
    fetchArticles({ sport: "nfl", limit: 25 }), // news
    fetchArticles({ sport: "nfl", topic: "rankings", limit: 10 }),
    fetchArticles({ sport: "nfl", topic: "start-sit", week: CURRENT_WEEK, limit: 12 }),
    fetchArticles({ sport: "nfl", topic: "advice", limit: 10 }),
    fetchArticles({ sport: "nfl", topic: "dfs", limit: 10 }),
    fetchArticles({ sport: "nfl", topic: "waiver-wire", limit: 10 }),
    fetchArticles({ sport: "nfl", topic: "injury", limit: 10 }),
    fetchArticles({ sport: "nfl", limit: 12 }),
  ]);

  // hero
  const heroRow = heroCandidates.find(
    (a) => a.image_url && !isLikelyFavicon(a.image_url)
  );

  const hero: HeroData | null = heroRow
    ? { title: heroRow.title, href: `/go/${heroRow.id}`, src: heroRow.image_url!, source: heroRow.source }
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

  // --- section toggle via ?section= ---
  const sectionParam = (typeof sp.section === "string" ? sp.section : undefined) as
    | SectionKey
    | undefined;

  const sectionMap: Record<SectionKey, { title: string; items: Article[] }> = {
    news: { title: "News & Updates", items: latestFiltered },
    rankings: { title: "Rankings", items: rankingsFiltered },
    "start-sit": { title: `${weekLabel(CURRENT_WEEK)} Start/Sit & Sleepers`, items: startSitFiltered },
    injury: { title: "Injuries", items: injuriesFiltered },
    dfs: { title: "DFS", items: dfsFiltered },
    waivers: { title: "Waiver Wire", items: waiversFiltered },
    advice: { title: "Advice", items: adviceFiltered },
  };

  const isFiltered = !!sectionParam && sectionMap[sectionParam as SectionKey];

  return (
    <Suspense fallback={null}>
      <main className="mx-auto max-w-[100%] px-2 sm:px-6 lg:px-8 py-6">
        {/* Header block – pills live in TopToolbar; keep the H1 */}
        <header className="mb-6 text-center">
          <h1
            className="font-extrabold tracking-tight text-black
                      text-5xl sm:text-6xl md:text-7xl lg:text-8xl
                      leading-[0.9]"
          >
            The Fantasy Report
          </h1>
        </header>

        {/* When a pill is active, show only that section; hide hero + grid */}
        {isFiltered ? (
          <div className="mx-auto max-w-2xl">
            <Section title={sectionMap[sectionParam as SectionKey].title}>
              <ArticleList items={sectionMap[sectionParam as SectionKey].items} />
            </Section>
          </div>
        ) : (
          <>
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
            
 <div className="flex justify-end px-3 py-2">
      <ImageToggle />
    </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1.2fr_1fr]">
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

              <div className="order-1 md:order-2 space-y-4">
                <Section title="News & Updates">
                  <ArticleList items={latestFiltered} />
                </Section>
              </div>

              <div className="order-3 space-y-4">
                
                <Section title="Advice">
                  <ArticleList items={adviceFiltered} />
                </Section>
                <Section title="DFS">
                  <ArticleList items={dfsFiltered} />
                </Section>
                <Section title="Injuries">
                  <ArticleList items={injuriesFiltered} />
                </Section>
                <Section title="Sites">
                  <FantasyLinks />
                </Section>
              </div>
            </div>
          </>
        )}
      </main>
    </Suspense>
  );
}
