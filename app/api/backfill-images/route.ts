// app/api/backfill-images/route.ts
//export CRON_SECRET=super-long-random-string
//-H "Authorization: Bearer $CRON_SECRET" >   "http://localhost:3000/api/backfill-images?limit=100&staleHours=720"


import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { findArticleImage } from "@/lib/scrape-image";
import { getSafeImageUrl, isLikelyFavicon, isWeakArticleImage, extractLikelyNameFromTitle } from "@/lib/images";
import { logIngest } from "@/lib/ingestLogs";
// If you have this helper in enrich.ts (as discussed), import it:
import { fetchOgImage } from "@/lib/enrich";
// Optional wiki fallback if present in your repo
import { findWikipediaHeadshot } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type Row = {
  id: number;
  source_id: number;
  url: string;
  title: string | null;
  image_url: string | null;
};

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function isPlaceholder(u: string | null): boolean {
  if (!u) return true;
  return /(cdn\.yourdomain\.com|picsum\.photos|images\.unsplash\.com)/i.test(u);
}

function parseLimit(v: string | null): number {
  const n = Number(v ?? "");
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 200) : 50;
}
function parseHours(v: string | null, def: number): number {
  const n = Number(v ?? "");
  return Number.isFinite(n) ? Math.max(1, Math.min(n, 24 * 30)) : def;
}

async function pickBestImage(articleUrl: string, title: string | null): Promise<string | null> {
  // 1) OG/Twitter
  const og = await fetchOgImage(articleUrl).catch(() => null);
  let candidate = getSafeImageUrl(og);

  // 2) Lightweight scraper (meta/JSON-LD/body)
  if (!candidate) {
    const scraped = await findArticleImage(articleUrl).catch(() => null);
    candidate = getSafeImageUrl(scraped);
  }

  // 3) Player headshot (optional) when title looks like a person
  if (!candidate && title) {
    const name = extractLikelyNameFromTitle(title);
    if (name) {
      const wiki = await findWikipediaHeadshot(name).catch(() => null);
      candidate = getSafeImageUrl(wiki?.src ?? null);
    }
  }

  if (!candidate) return null;
  if (isLikelyFavicon(candidate) || isWeakArticleImage(candidate)) return null;
  return candidate;
}

export async function GET(req: NextRequest) {
  // Auth: either Bearer header or ?key=
  const url = new URL(req.url);
  const keyParam = url.searchParams.get("key");
  const token = bearer(req) ?? keyParam ?? "";
  const secret = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || "";
  if (secret && token !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const staleHours = parseHours(url.searchParams.get("staleHours"), 24 * 7); // default: 7 days
  const dryRun = url.searchParams.has("dry");

  const selectSql = `
    SELECT id, source_id, url, title, image_url
    FROM articles
    WHERE url IS NOT NULL
      AND (
            image_url IS NULL
         OR image_url = ''
         OR image_url ~ '^(https?://)?(cdn\\.yourdomain\\.com|picsum\\.photos|images\\.unsplash\\.com)'
         OR image_checked_at IS NULL
         OR image_checked_at < NOW() - ($2 || ' hours')::interval
      )
    ORDER BY discovered_at DESC NULLS LAST, id DESC
    LIMIT $1
  `;

  try {
    const { rows } = await dbQuery<Row>(selectSql, [limit, String(staleHours)]);

    let scanned = 0;
    let updated = 0;
    let unchanged = 0;
    let notFound = 0;
    const items: Array<{ id: number; url: string; action: "updated" | "unchanged" | "not-found"; found?: string | null }> = [];

    for (const r of rows) {
      scanned++;

      const found = await pickBestImage(r.url, r.title);

      if (!found) {
        notFound++;
        items.push({ id: r.id, url: r.url, action: "not-found" });

        // still stamp image_checked_at so we don't retry immediately
        if (!dryRun) {
          await dbQuery(`UPDATE articles SET image_checked_at = NOW() WHERE id = $1`, [r.id]);
        }

        // optional log line
        await logIngest({
          sourceId: r.source_id,
          url: r.url,
          title: r.title ?? null,
          reason: "filtered_out",
          detail: "no usable image found",
        });
        continue;
      }

      // Skip write when identical
      if (r.image_url && !isPlaceholder(r.image_url) && r.image_url === found) {
        unchanged++;
        items.push({ id: r.id, url: r.url, action: "unchanged", found });

        if (!dryRun) {
          await dbQuery(`UPDATE articles SET image_checked_at = NOW() WHERE id = $1`, [r.id]);
        }
        continue;
      }

      if (!dryRun) {
        await dbQuery(
          `UPDATE articles
             SET image_url = $1,
                 image_checked_at = NOW()
           WHERE id = $2`,
          [found, r.id]
        );
      }

      updated++;
      items.push({ id: r.id, url: r.url, action: "updated", found });

      // optional log line
      await logIngest({
        sourceId: r.source_id,
        url: r.url,
        title: r.title ?? null,
        reason: "ok_update",
        detail: "image backfilled",
      });
    }

    return NextResponse.json(
      {
        ok: true,
        scanned,
        updated,
        unchanged,
        notFound,
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
