// app/api/waivers/probe-yahoo/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { dbQuery } from "@/lib/db";
import { extractYahoo } from "@/lib/site-extractors/yahoo";
import type { WaiverHit } from "@/lib/site-extractors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YAHOO_SOURCE_ID = 9999; // ← replace with your real source_id

function hasDeepStashWording(s: string): boolean {
  return /(deep\s*stash|deep-?stashes|stash(?:es)?\s*(?:for|to|candidates|targets)|deep\s*league\s*stash)/i.test(
    s
  );
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
  return (
    hasDeepStashWording(url.pathname) ||
    hasDeepStashWording(getTitleLike(html)) ||
    hasDeepStashWording(h1)
  );
}

function fromHintFor(hit: WaiverHit, articleIsDeep: boolean): string {
  if (articleIsDeep) return "deep_stash";
  if (hit.section && /deep\s*stash/i.test(hit.section)) return "deep_stash";
  if (hit.section && /honou?rable mentions/i.test(hit.section)) return "honorable";
  return "main";
}

function keyFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const week = Number(u.searchParams.get("week") ?? NaN);
  const seeds: string[] = [
    "https://sports.yahoo.com/fantasy/football/",
    "https://sports.yahoo.com/fantasy/nfl/",
  ];

  const found = new Set<string>();
  for (const seed of seeds) {
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
      const looksWaiver =
        /waiver/i.test(href) || /waiver/i.test(text) || /add(?:s|ers)?/i.test(text) || /deep/i.test(text);
      if (/^https?:\/\/sports\.yahoo\.com\/fantasy\//i.test(abs) && looksWaiver) {
        found.add(abs);
      }
    }
  }

  const inserted: Array<{ url: string; mentions: number }> = [];
  for (const urlStr of found) {
    const resp = await fetch(urlStr, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });
    if (!resp.ok) continue;

    const html = await resp.text();
    const urlObj = new URL(urlStr);
    const deepArticle = isArticleDeep(urlObj, html);
    const hits = extractYahoo(html, urlObj);

    let count = 0;
    for (const h of hits) {
      const playerName = h.name;
      const playerKey = keyFromName(playerName);
      const role = h.pos ?? null;
      const fromHint = fromHintFor(h, deepArticle);

      await dbQuery(
        `
        insert into waiver_mentions
          (article_id, player_key, player_name, rank_hint, confidence, created_at, week, source_id, player_id, role, from_hint)
        values
          (null, $1, $2, null, null, now(), $3, $4, null, $5, $6)
        on conflict do nothing
        `,
        [playerKey, playerName, Number.isFinite(week) ? week : null, YAHOO_SOURCE_ID, role, fromHint]
      );
      count += 1;
    }
    inserted.push({ url: urlStr, mentions: count });
  }

  return NextResponse.json({
    ok: true,
    week: Number.isFinite(week) ? week : null,
    articlesFound: found.size,
    insertedByUrl: inserted,
  });
}
