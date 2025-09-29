import { NextRequest, NextResponse } from "next/server";
import { dbQueryRows } from "@/lib/db";
import { getHomeData } from "@/lib/HomeData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long a manual hero should “stick” before auto kicks in */
const MANUAL_TTL_MINUTES = 360; // 6 hours

type HeroRow = {
  id: number;
  article_id: number;
  url: string;
  title: string;
  image_url: string | null;
  source: string | null;
  created_at: string;
};

export async function GET(_req: NextRequest) {
  // 1) recent manual hero?
  const manual = await dbQueryRows<HeroRow>(
    `select id, article_id, url, title, image_url, source, created_at
       from site_hero
      where created_at >= now() - interval '${MANUAL_TTL_MINUTES} minutes'
      order by created_at desc
      limit 1`
  );

  if (manual.length) {
    const m = manual[0];
    const createdAt = new Date(m.created_at).toISOString();
    const expiresAt = new Date(
      new Date(m.created_at).getTime() + MANUAL_TTL_MINUTES * 60 * 1000
    ).toISOString();

    return NextResponse.json({
      mode: "manual" as const,
      hero: {
        title: m.title,
        href: m.url,
        src: m.image_url ?? undefined,
        source: m.source ?? "The Fantasy Report",
      },
      createdAt,
      expiresAt,
    });
  }

  // 2) auto-pick from fresh “news/breaking” leaning pool
  const { items } = await getHomeData({
    days: 3,
    limitNews: 24,
    limitHero: 36,
    // make the hero pool heavy on NEWS first
  });

  // scoring: strong bias for breaking/news/injury/trade + recency
  const now = Date.now();
  const scored = items.heroCandidates
    .map((r) => {
      const t = `${r.title ?? ""}`.toLowerCase();
      const ts = r.published_at ? Date.parse(r.published_at) : now - 1000 * 60 * 60 * 24;
      const hoursOld = Math.max(0, (now - ts) / 36e5);

      let score = 0;
      if (/breaking|news|per\s+source|ruled\s+out|injury|carted|trade|signed|released|activated|designated/i.test(t)) score += 50;
      if (/actives|inactives|status|game-time/i.test(t)) score += 20;
      // freshness curve: 0–12h strong, then decays
      score += Math.max(0, 40 - hoursOld * 3);

      // tiny nudge for hero-friendly images
      if (r.image_url) score += 5;

      return { r, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored[0]?.r;
  if (!top) {
    return NextResponse.json({ mode: "empty", hero: null });
  }

  return NextResponse.json({
    mode: "auto" as const,
    hero: {
      title: top.title ?? "(untitled)",
      href: top.canonical_url ?? top.url,
      src: top.image_url ?? undefined,
      source: top.source ?? top.domain ?? "The Fantasy Report",
    },
    createdAt: new Date().toISOString(),
    expiresAt: null, // auto mode doesn’t have a fixed expiry 
  });
}

