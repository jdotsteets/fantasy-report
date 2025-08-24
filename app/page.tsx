// app/page.tsx
import ArticleList from "@/components/ArticleList";
import Section from "@/components/Section";
import TopicNav from "@/components/TopicNav";
import Hero from "@/components/Hero";
import FantasyLinks from "@/components/FantasyLinks";
import type { Article } from "@/types/sources";
import { isLikelyFavicon } from "@/lib/images"; // ⬅️ reuse the same detector

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Search = { week?: string };

type HeroData = {
  title: string;
  href: string;
  src: string;
  source: string;
};

// Build absolute URLs for server-side fetches
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
  // default window to keep queries light (server also supports this)
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
        // Retry on transient statuses
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
        // server now returns { error: "..."} on failures
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
      // Retry aborted / network failures
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
    fetchArticles({ sport: "nfl", limit: 25 }),
    fetchArticles({ sport: "nfl", topic: "rankings", limit: 10 }),
    fetchArticles({ sport: "nfl", topic: "start-sit", week: CURRENT_WEEK, limit: 12 }),
    fetchArticles({ sport: "nfl", topic: "advice", limit: 10 }),
    fetchArticles({ sport: "nfl", topic: "dfs", limit: 10 }),
    fetchArticles({ sport: "nfl", topic: "waiver-wire", limit: 10 }),
    fetchArticles({ sport: "nfl", topic: "injury", limit: 10 }),
    // fetch several so we can skip favicon/stock images for the hero
    fetchArticles({ sport: "nfl", limit: 12 }),
  ]);

  // Pick the first hero with a non-favicon/non-stock image
  const heroRow = heroCandidates.find(
    (a) => a.image_url && !isLikelyFavicon(a.image_url)
  );

  const hero: HeroData | null = heroRow
    ? {
        title: heroRow.title,
        href: `/go/${heroRow.id}`,
        src: heroRow.image_url!,
        source: heroRow.source,
      }
    : null;

  // Filter the hero out of all other sections
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
    <main className="mx-auto w-full px-4 py-6">
      <header className="mb-6 text-center">
        <h1 className="text-8xl font-extrabold tracking-tight text-black">The Fantasy Report</h1>
        <div className="mt-4">
          <TopicNav />
        </div>
      </header>

      {hero ? (
        <div className="mb-8 mx-auto max-w-2xl">
          <Hero title={hero.title} href={hero.href} src={hero.src} source={hero.source} />
        </div>
      ) : null}

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
    </main>
  );
}
