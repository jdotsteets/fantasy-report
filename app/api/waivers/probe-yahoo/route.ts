//app/api/waivers/probe-yahoo/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { dbQuery } from "@/lib/db";
import { extractYahoo } from "@/lib/site-extractors/yahoo";
import type { WaiverHit } from "@/lib/site-extractors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YAHOO_SOURCE_ID = 9999 as const;

/* ───────────────────────── Helpers ───────────────────────── */

function hasDeepStashWording(s: string): boolean {
  return /(deep\s*stash|deep-?stashes|deep\s*league\s*stash|stash(?:es)?\s*(?:for|to|candidates|targets))/i.test(s);
}
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function getTitleLike(html: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? "";
  return (og || t || "").replace(/\s+/g, " ").trim();
}
function isArticleDeep(url: URL, html: string): boolean {
  const h1 = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  return hasDeepStashWording(url.pathname) || hasDeepStashWording(getTitleLike(html)) || hasDeepStashWording(h1);
}
function isStartSit(html: string): boolean {
  const title = getTitleLike(html) + " " + stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  return /\bstart\s*\/?\s*sit\b/i.test(title);
}
function fromHintFor(hit: WaiverHit, articleIsDeep: boolean): "deep_stash" | "honorable" | "main" {
  if (articleIsDeep) return "deep_stash";
  if (hit.section && /deep\s*stash/i.test(hit.section)) return "deep_stash";
  if (hit.section && /honou?rable mentions/i.test(hit.section)) return "honorable";
  return "main";
}
function keyFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
function isYahooArticleUrl(u: URL): boolean {
  if (!/^(?:www\.)?sports\.yahoo\.com$/i.test(u.hostname)) return false;
  return /^\/(?:fantasy|article)\b/i.test(u.pathname);
}
function inferWeek(url: URL, html: string): number | null {
  const candidates = [
    url.pathname,
    getTitleLike(html),
    stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""),
  ].join(" ");
  const m = candidates.match(/\bweek\s*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}
function looksWaiverish(href: string, text: string): boolean {
  const s = `${href} ${text}`.toLowerCase();
  if (/\bwaiver[-\s]?wire\b/.test(s) && (/\bpickups?\b/.test(s) || /\badds?\b/.test(s))) return true;
  if (/\bdeep\b/.test(s) && /\bstash(?:es)?\b/.test(s)) return true;
  return /\bwaiver\b/.test(s);
}

/* ───────────────────────── Handler ───────────────────────── */

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const weekParam = u.searchParams.get("week");
  const week = weekParam && !Number.isNaN(Number(weekParam)) ? Number(weekParam) : null;

  const dry = u.searchParams.get("dry") === "1";
  const sourceIdParam = u.searchParams.get("source_id");
  const sourceId = sourceIdParam && !Number.isNaN(Number(sourceIdParam)) ? Number(sourceIdParam) : YAHOO_SOURCE_ID;

  // Allow explicit URL(s)
  const urlParams = u.searchParams.getAll("url");
  const forcedUrls: string[] = [];
  for (const raw of urlParams) {
    for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      forcedUrls.push(part);
    }
  }

  const seeds: readonly string[] = [
    "https://sports.yahoo.com/fantasy/football/",
    "https://sports.yahoo.com/fantasy/nfl/",
    "https://sports.yahoo.com/article/",
    "https://sports.yahoo.com/tag/fantasy-football/",
  ] as const;

  const found = new Set<string>();

  // Add forced URLs first
  for (const raw of forcedUrls) {
    try {
      const urlObj = new URL(raw);
      if (isYahooArticleUrl(urlObj)) found.add(urlObj.href);
    } catch {
      /* ignore */
    }
  }

  // Probe seeds
  for (const seed of seeds) {
    try {
      const res = await fetch(seed, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const html = await res.text();

      const linkRx = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRx.exec(html)) !== null) {
        const href = m[1];
        const text = (m[2] || "").replace(/<[^>]+>/g, " ").trim();
        const abs = new URL(href, seed).href;
        const absUrl = new URL(abs);
        if (isYahooArticleUrl(absUrl) && looksWaiverish(href, text)) {
          found.add(absUrl.href);
        }
      }
    } catch {
      /* ignore seed errors */
    }
  }

  const scanned: Array<{ url: string; ok: boolean; status?: number }> = [];
  const errorsByUrl: Array<{ url: string; error: string }> = [];
  const parsedPreview: Array<{ url: string; deepArticle: boolean; hits: WaiverHit[]; week: number | null }> = [];
  const insertedByUrl: Array<{ url: string; mentions: number; week: number | null }> = [];

  for (const urlStr of found) {
    try {
      const resp = await fetch(urlStr, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
        cache: "no-store",
      });
      scanned.push({ url: urlStr, ok: resp.ok, status: resp.status });
      if (!resp.ok) continue;

      const html = await resp.text();
      if (isStartSit(html)) continue;

      const urlObj = new URL(urlStr);
      const deepArticle = isArticleDeep(urlObj, html);

      // ✅ infer week per article if not provided
      let effectiveWeek = week;
      if (effectiveWeek == null) {
        const guessed = inferWeek(urlObj, html);
        if (Number.isFinite(guessed ?? NaN)) effectiveWeek = guessed!;
      }

      const hits = extractYahoo(html, urlObj);
      parsedPreview.push({ url: urlStr, deepArticle, hits, week: effectiveWeek });

      if (dry) {
        insertedByUrl.push({ url: urlStr, mentions: hits.length, week: effectiveWeek });
        continue;
      }

      let count = 0;
      for (const h of hits) {
        const playerName = h.name;
        const playerKey = keyFromName(playerName);
        const role = h.pos ?? null;
        const fromHint = fromHintFor(h, deepArticle);

        try {
          await dbQuery(
            `
            insert into waiver_mentions
              (player_key, player_name, week, role, from_hint, created_at, source_id)
            values
              ($1, $2, $3, $4, $5, now(), $6)
            on conflict do nothing
            `,
            [playerKey, playerName, effectiveWeek, role, fromHint, sourceId]
          );
          count += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errorsByUrl.push({ url: urlStr, error: `insert failed for ${playerName}: ${msg}` });
        }
      }
      insertedByUrl.push({ url: urlStr, mentions: count, week: effectiveWeek });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errorsByUrl.push({ url: urlStr, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    week, // original query param (may be null)
    seeds: seeds.length,
    articlesFound: found.size,
    scanned,
    insertedByUrl,
    forcedUrlCount: forcedUrls.length,
    dry,
    parsedPreview,
    errorsByUrl,
  });
}
