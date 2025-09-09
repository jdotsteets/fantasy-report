// app/api/backfill-images/route.ts
// Usage:
// export CRON_SECRET=super-long-random-string
// curl -H "Authorization: Bearer $CRON_SECRET" \
//   "http://localhost:3000/api/backfill-images?limit=100&staleHours=720"

import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { fetchOgImage } from "@/lib/enrich";
import { findArticleImage } from "@/lib/scrape-image";
import {
  getSafeImageUrl,
  isLikelyFavicon,
  isWeakArticleImage,
  extractLikelyNameFromTitle,
} from "@/lib/images";
import { logIngest } from "@/lib/ingestLogs";
import { upsertPlayerImage } from "@/lib/ingestPlayerImages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type Row = {
  id: number;
  source_id: number;
  url: string | null;
  canonical_url: string | null;
  title: string | null;
  image_url: string | null;
  players: string[] | null;
};

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  const m = h ? /^Bearer\s+(.+)$/i.exec(h) : null;
  return m ? m[1] : null;
}

function parseLimit(v: string | null): number {
  const n = Number(v ?? "");
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 200) : 50;
}
function parseHours(v: string | null, def: number): number {
  const n = Number(v ?? "");
  return Number.isFinite(n) ? Math.max(1, Math.min(n, 24 * 30)) : def;
}

function toPlayerKey(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `nfl:name:${slug}`;
}

/** Block typical author/byline/avatar URLs (Yahoo/USAToday/Wire/CDNs, etc.) */
function isAuthorImage(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (
    u.includes("authoring-images") || // Gannett/USAToday
    u.includes("/byline/") ||
    u.includes("/authors/") ||
    u.includes("/author/") ||
    u.includes("/profile/") ||
    u.includes("/profiles/") ||
    u.includes("headshot") ||
    u.includes("avatar") ||
    u.includes("/wp-content/uploads/avatars/")
  ) return true;

  // Tiny square hints common for bylines (?width=144&height=144, etc.)
  if (/[?&](w|width)=1\d{2}\b/.test(u) && /[?&](h|height)=1\d{2}\b/.test(u)) return true;

  return false;
}

/** Normalize and enforce all filters (favicon, weak, author). */
function normalizeCandidate(u: string | null | undefined): string | null {
  const s = getSafeImageUrl(u);
  if (!s) return null;
  if (isLikelyFavicon(s)) return null;
  if (isWeakArticleImage(s)) return null;
  if (/\.(svg)(\?|#|$)/i.test(s)) return null;
  if (isAuthorImage(s)) return null;
  return s;
}

async function pickBestImage(articleUrl: string, title: string | null): Promise<string | null> {
  // 1) OG/Twitter
  const og = await fetchOgImage(articleUrl).catch(() => null);
  let candidate = normalizeCandidate(og);

  // 2) Scrape (meta/JSON-LD/body)
  if (!candidate) {
    const scraped = await findArticleImage(articleUrl).catch(() => null);
    candidate = normalizeCandidate(scraped);
  }

  // 3) (Optional) wiki/person fallback — keep disabled unless you wire it up
  // const name = title ? extractLikelyNameFromTitle(title) : null;
  // if (!candidate && name) {
  //   const wiki = await findWikipediaHeadshot(name).catch(() => null);
  //   candidate = normalizeCandidate(wiki?.src ?? null);
  // }

  return candidate ?? null;
}

export async function GET(req: NextRequest) {
  // Auth
  const url = new URL(req.url);
  const token = bearer(req) ?? url.searchParams.get("key") ?? "";
  const secret = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || "";
  if (secret && token !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const staleHours = parseHours(url.searchParams.get("staleHours"), 24 * 7);
  const dryRun = url.searchParams.has("dry");

  // Broaden the “needs work” predicate, including known author/byline patterns
  const selectSql = `
    SELECT id, source_id, url, canonical_url, title, image_url, players
    FROM articles
    WHERE (url IS NOT NULL OR canonical_url IS NOT NULL)
      AND (
           image_url IS NULL
        OR image_url = ''
        OR image_checked_at IS NULL
        OR image_checked_at < NOW() - ($2 || ' hours')::interval
        OR image_url ~* '(1x1|pixel|tracker|spacer|placeholder|blank|\\.gif($|\\?))'
        OR image_url ~* '(authoring-images|/byline/|/authors?/|/profile(s)?/|headshot|avatar|/wp-content/uploads/avatars/)'
      )
    ORDER BY COALESCE(published_at, discovered_at) DESC NULLS LAST, id DESC
    LIMIT $1
  `;

  try {
    const res = await dbQuery<Row>(selectSql, [limit, String(staleHours)]);
    const rows = (Array.isArray(res) ? res : (res as any).rows) as Row[];

    let scanned = 0;
    let updated = 0;
    let unchanged = 0;
    let notFound = 0;
    let seeded = 0;

    const items: Array<{
      id: number;
      url: string | null;
      action: "updated" | "unchanged" | "not-found";
      found?: string | null;
    }> = [];

    for (const r of rows) {
      scanned++;
      const fetchUrl = r.canonical_url || r.url!;
      if (!fetchUrl) continue;

      const found = await pickBestImage(fetchUrl, r.title);

      if (!found) {
        notFound++;
        items.push({ id: r.id, url: fetchUrl, action: "not-found" });

        if (!dryRun) {
          await dbQuery(`UPDATE articles SET image_checked_at = NOW() WHERE id = $1`, [r.id]);
        }

        await logIngest({
          sourceId: r.source_id,
          url: fetchUrl,
          title: r.title ?? null,
          reason: "filtered_out",
          detail: "no usable image found",
        });
        continue;
      }

      // Only treat as unchanged if the stored one isn't weak/author-ish
      const storedIsOk =
        r.image_url &&
        !isWeakArticleImage(r.image_url) &&
        !isLikelyFavicon(r.image_url) &&
        !isAuthorImage(r.image_url);

      if (storedIsOk && r.image_url === found) {
        unchanged++;
        items.push({ id: r.id, url: fetchUrl, action: "unchanged", found });
        if (!dryRun) {
          await dbQuery(`UPDATE articles SET image_checked_at = NOW() WHERE id = $1`, [r.id]);
        }
        continue;
      }

      if (!dryRun) {
        await dbQuery(
          `UPDATE articles
             SET image_url = $1,
                 image_source = 'scraped',
                 image_checked_at = NOW()
           WHERE id = $2`,
          [found, r.id]
        );
      }
      updated++;
      items.push({ id: r.id, url: fetchUrl, action: "updated", found });

      await logIngest({
        sourceId: r.source_id,
        url: fetchUrl,
        title: r.title ?? null,
        reason: "ok_update",
        detail: "image backfilled",
      });

      // Opportunistic player_images seed
      const single =
        (r.players && r.players.length === 1 && r.players[0]) ||
        (r.title ? extractLikelyNameFromTitle(r.title) : null);

      if (single) {
        try {
          await upsertPlayerImage({ key: toPlayerKey(single), url: found });
          seeded++;
        } catch {
          /* ignore seeding errors */
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        scanned,
        updated,
        unchanged,
        notFound,
        player_images_seeded: seeded,
        limit,
        staleHours,
        dryRun: !!dryRun,
        items,
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
