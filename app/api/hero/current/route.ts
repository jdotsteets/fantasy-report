// app/api/hero/current/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQueryRows } from "@/lib/db";
import { fetchSectionItems, type SectionRow } from "@/lib/sectionQuery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15; // keep functions short on Vercel

const MANUAL_TTL_MINUTES = 360; // 6 hours
const TIMEOUT_DB_MS = 1_500;
const TIMEOUT_NEWS_MS = 2_500;

// Tweak as you like
const NEWS_LIMIT = 36;       // pool size to score
const NEWS_DAYS = 3;         // lookback
const PER_PROVIDER_CAP = 3;  // keep variety in pool

type HeroRow = {
  id: number;
  article_id: number;
  url: string;
  title: string;
  image_url: string | null;
  source: string | null;
  created_at: string;
};

type HeroPayload = {
  mode: "manual" | "auto" | "empty" | "fallback";
  hero: {
    title: string;
    href: string;
    src?: string;
    source?: string;
  } | null;
  createdAt?: string | null;
  expiresAt?: string | null;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function okJson(payload: HeroPayload, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
  return res;
}

function scoreNews(rows: SectionRow[]): SectionRow | undefined {
  const now = Date.now();
  const scored = rows
    .map((r) => {
      const t = `${r.title ?? ""}`.toLowerCase();
      const ts = r.published_at ? Date.parse(r.published_at) : now - 86_400_000; // 24h ago
      const hoursOld = Math.max(0, (now - ts) / 3.6e6);

      let score = 0;
      // breaking / transaction / injury language
      if (
        /breaking|news|per\s+source|ruled\s+out|injury|carted|trade|signed|released|activated|designated/i.test(t)
      ) score += 50;
      if (/actives|inactives|status|game-time/i.test(t)) score += 20;

      // freshness curve (0–12h favored)
      score += Math.max(0, 40 - hoursOld * 3);

      // small nudge if it has an image
      if (r.image_url) score += 5;

      return { r, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.r;
}

export async function GET(_req: NextRequest) {
  try {
    // 1) recent manual hero (fast path, time-capped)
    const manual = await withTimeout(
      dbQueryRows<HeroRow>(
        `select id, article_id, url, title, image_url, source, created_at
           from site_hero
          where created_at >= now() - interval '${MANUAL_TTL_MINUTES} minutes'
          order by created_at desc
          limit 1`
      ),
      TIMEOUT_DB_MS,
      "manual-hero"
    );

    if (manual.length > 0) {
      const m = manual[0];
      const createdAtIso = new Date(m.created_at).toISOString();
      const expiresAtIso = new Date(
        new Date(m.created_at).getTime() + MANUAL_TTL_MINUTES * 60 * 1000
      ).toISOString();

      return okJson({
        mode: "manual",
        hero: {
          title: m.title,
          href: m.url,
          src: m.image_url ?? undefined,
          source: m.source ?? "The Fantasy Report",
        },
        createdAt: createdAtIso,
        expiresAt: expiresAtIso,
      });
    }

    // 2) NEWS-ONLY pool (fast, direct)
    const news = await withTimeout(
      fetchSectionItems({
        key: "news",
        limit: NEWS_LIMIT,
        days: NEWS_DAYS,
        perProviderCap: PER_PROVIDER_CAP,
        staticMode: "exclude",
        sport: "nfl",
      }),
      TIMEOUT_NEWS_MS,
      "news-pool"
    );

    const top = scoreNews(news);
    if (!top) {
      return okJson({ mode: "empty", hero: null });
    }

    return okJson({
      mode: "auto",
      hero: {
        title: top.title ?? "(untitled)",
        href: top.canonical_url ?? top.url,
        src: top.image_url ?? undefined,
        source: top.source ?? top.domain ?? "The Fantasy Report",
      },
      createdAt: new Date().toISOString(),
      expiresAt: null,
    });
  } catch (err) {
    console.error("[/api/hero/current] failed:", err);
    // Hard fallback so the route never 504s
    return okJson(
      {
        mode: "fallback",
        hero: {
          title: "Latest from The Fantasy Report",
          href: "https://www.thefantasyreport.com/news",
          src: undefined,
          source: "The Fantasy Report",
        },
        createdAt: new Date().toISOString(),
        expiresAt: null,
      },
      200
    );
  }
}
