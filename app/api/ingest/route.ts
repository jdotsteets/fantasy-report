// app/api/ingest/route.ts
import { NextResponse } from "next/server";
import { withClient } from "@/lib/db";
import { fetchFeed, type FeedItem } from "@/lib/feeds";
import type { PoolClient, QueryResult } from "pg";

export const runtime = "nodejs";
export const preferredRegion = ["iad1"];

type SourceRow = {
  id: number;
  name: string;
  homepage_url: string;
  rss_url: string | null;
  sitemap_url: string | null;
  favicon_url: string | null;
  allowed: boolean;
  priority: number;
  category: string | null;
  sport: string | null;
  notes: string | null;
  scrape_path: string | null;
  scrape_selector: string | null;
  paywall: boolean | null;
};

const GLOBAL_DENY: ReadonlyArray<RegExp> = [
  /\/subscribe/i, /\/subscription/i, /\/premium/i, /\/insider/i, /\/edge\//i, /\/plus\//i,
];

function normalizeUrl(u: string): string {
  try { return new URL(u).toString(); } catch { return u; }
}
function urlDomain(u: string): string | null {
  try { return new URL(u).hostname.replace(/^www\./i, ""); } catch { return null; }
}
function errorMessage(e: unknown): string { return e instanceof Error ? e.message : String(e); }

const seen = new Set<string>(); // per-request dedupe

async function ingestSource(src: SourceRow, c: PoolClient) {
  if (!src.allowed) return { id: src.id, name: src.name, inserted: 0, skipped: "not allowed" as const };

  // determine the URL to fetch (RSS or list page)
  let feedUrl: string | undefined = src.rss_url ?? undefined;
  if (!feedUrl && src.homepage_url.includes("fantasypros.com")) {
    feedUrl = "https://www.fantasypros.com/nfl/rss.php"; // fallback
  }
  if (!feedUrl && src.scrape_path) {
    try { feedUrl = new URL(src.scrape_path, src.homepage_url).toString(); } catch {}
  }
  if (!feedUrl) return { id: src.id, name: src.name, inserted: 0, skipped: "no feed or list url" as const };

  let items: FeedItem[];
  try {
    items = await fetchFeed({ url: feedUrl, dropPremium: true, denyPatterns: [...GLOBAL_DENY] });
  } catch (e) {
    return { id: src.id, name: src.name, inserted: 0, error: errorMessage(e) };
  }

  // insert/upsert
  let inserted = 0;
  for (const it of items) {
    const url = normalizeUrl(it.link);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    if (GLOBAL_DENY.some((re) => re.test(url))) continue;

    const domain = urlDomain(url);
    const title = (it.title ?? "").slice(0, 400);
    const publishedAt = it.publishedAt ? new Date(it.publishedAt) : null;
    const topics = src.category ? [src.category] : [];

    try {
      const res: QueryResult = await c.query(
        `
        INSERT INTO articles (
          source_id, sport, title, url, canonical_url, domain,
          published_at, discovered_at, topics
        ) VALUES (
          $1, $2, $3, $4, NULL, $5,
          $6, NOW(), $7::text[]
        )
        ON CONFLICT (url) DO UPDATE SET
          title         = EXCLUDED.title,
          domain        = COALESCE(articles.domain, EXCLUDED.domain),
          published_at  = COALESCE(EXCLUDED.published_at, articles.published_at),
          discovered_at = COALESCE(articles.discovered_at, EXCLUDED.discovered_at)
        `,
        [
          src.id,                             // $1  source_id
          src.sport ?? "nfl",                 // $2  sport
          title,                              // $3  title
          url,                                // $4  url
          domain,                             // $5  domain
          publishedAt,                        // $6  published_at
          topics,                             // $7  topics::text[]
        ]
      );
      inserted += res.rowCount ?? 0;
    } catch (e) {
      console.error("[ingest insert error]", src.name, url, errorMessage(e));
    }
  }
  return { id: src.id, name: src.name, inserted };
}

export async function GET() {
  try {
    const report = await withClient(async (c) => {
      const { rows } = await c.query<SourceRow>(`
        SELECT id, name, homepage_url, rss_url, sitemap_url, favicon_url, allowed,
               priority, category, sport, notes, scrape_path, scrape_selector, paywall
        FROM sources
        WHERE allowed = TRUE
        ORDER BY priority DESC, id ASC
        LIMIT 80
      `);

      const results: Array<
        | { id: number; name: string; inserted: number }
        | { id: number; name: string; inserted: 0; skipped: string }
        | { id: number; name: string; inserted: 0; error: string }
      > = [];

      // sequential (safe under Vercel 60s). You can batch with small concurrency later.
      for (const src of rows) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await ingestSource(src, c));
      }
      return results;
    });

    return NextResponse.json({ ok: true, report });
  } catch (e) {
    console.error("[/api/ingest] fatal", errorMessage(e));
    return NextResponse.json({ ok: false, error: "ingest_failed" }, { status: 500 });
  }
}
