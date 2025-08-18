// app/api/ingest/route.ts
import Parser from "rss-parser";
import { query } from "@/lib/db";
import { enrich } from "@/lib/enrich";

export const runtime = "nodejs";
// @ts-ignore: Next.js route option (not in TS types), extends serverless timeout
export const maxDuration = 60;

type FeedSource = {
  name: string;
  rss: string;
  homepage?: string;
  favicon?: string;
  priority?: number;
};

const SOURCES: FeedSource[] = [
  { name: "CBS Fantasy", rss: "https://www.cbssports.com/fantasy/football/rss/", homepage: "https://www.cbssports.com/fantasy/football/" },
  { name: "NBC Sports Edge", rss: "https://www.nbcsports.com/rss/edge/football", homepage: "https://www.nbcsports.com/edge" },
  { name: "Razzball (NFL)", rss: "https://razzball.com/fantasy-football/feed/", homepage: "https://razzball.com" },
  { name: "FantasyPros NFL News", rss: "https://www.fantasypros.com/news/nfl.xml", homepage: "https://www.fantasypros.com" },
  { name: "Yahoo Sports NFL", rss: "https://sports.yahoo.com/nfl/rss.xml", homepage: "https://sports.yahoo.com/nfl" },
  { name: "Rotoballer NFL", rss: "https://www.rotoballer.com/category/nfl/feed", homepage: "https://www.rotoballer.com" },
  { name: "NumberFire NFL", rss: "https://www.numberfire.com/nfl/rss", homepage: "https://www.numberfire.com/nfl" },
  { name: "Pro Football Rumors", rss: "https://www.profootballrumors.com/feed", homepage: "https://www.profootballrumors.com" },
  { name: "The Draft Network", rss: "https://thedraftnetwork.com/feed", homepage: "https://thedraftnetwork.com" },
  { name: "Rotowire NFL", rss: "https://www.rotowire.com/rss/news.php?sport=NFL", homepage: "https://www.rotowire.com/football/" },
  { name: "Sharp Football", rss: "https://sharpfootballanalysis.com/feed/", homepage: "https://sharpfootballanalysis.com" },
  { name: "4for4 (headlines feed)", rss: "https://www.4for4.com/feeds/latest", homepage: "https://www.4for4.com" },
  { name: "PFF NFL News", rss: "https://www.pff.com/news/feed", homepage: "https://www.pff.com/news/nfl" },
  { name: "FOOTBALL GUYS (news)", rss: "https://www.footballguys.com/rss.xml", homepage: "https://www.footballguys.com" },
  { name: "The Athletic NFL (free articles only)", rss: "https://theathletic.com/league/nfl/feed/", homepage: "https://theathletic.com/nfl/" }
];

type ErrorEntry = { source: string; error: string };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  // ---- AUTH: require CRON_SECRET if set ----
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  const urlKey = url.searchParams.get("key") || "";
  if (secret && authHeader !== `Bearer ${secret}` && urlKey !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }
  // -----------------------------------------

  const parser = new Parser({
    headers: { "user-agent": "FantasyAggregatorBot/0.1 (contact: you@example.com)" }
  });

  let inserted = 0;
  const errors: ErrorEntry[] = [];

  try {
    for (const src of SOURCES) {
      try {
        // upsert source
        await query(
          `insert into sources(name, homepage_url, rss_url, favicon_url, priority)
           values($1,$2,$3,$4,$5)
           on conflict (name) do update set rss_url=excluded.rss_url, homepage_url=excluded.homepage_url`,
          [src.name, src.homepage || null, src.rss, src.favicon || null, src.priority ?? 0]
        );

        const feed = await parser.parseURL(src.rss);

        for (const item of feed.items as Array<{ link?: string; title?: string; isoDate?: string }>) {
          if (!item?.link) continue;

          // Enrich one item
          const e = enrich(src.name, item);

          // Insert if new (dedupe on canonical_url)
          const res = await query(
            `insert into articles(
                source_id, url, canonical_url, domain,
                title, cleaned_title, slug, fingerprint,
                published_at, discovered_at, sport, season, week, topics
             )
             values (
                (select id from sources where name=$1),
                $2, $3, $4,
                $5, $6, $7, $8,
                $9::timestamptz,
                now(),
                'nfl',
                extract(year from now())::int,
                $10,
                $11
             )
             on conflict (canonical_url) do nothing
             returning id`,
            [
              src.name,
              e.url,
              e.canonical_url,
              e.domain,
              (item.title || "").slice(0, 280),
              e.cleaned_title.slice(0, 280),
              e.slug.slice(0, 120),
              e.fingerprint,
              e.published_at,
              e.week,
              e.topics
            ]
          );

          inserted += res.rows.length;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ source: src.name, error: message });
        console.warn(`[ingest] ${src.name} failed: ${message}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, inserted, ...(debug ? { errors } : {}) }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
}
