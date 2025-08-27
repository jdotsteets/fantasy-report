// app/api/x/rankings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { searchRecent, Tweet, User } from "@/lib/x/client";
import { parseRankingList } from "@/lib/x/parser";
import { dbQuery } from "@/lib/db";

// Weighting knobs
const BASE_WEIGHT = 1.0;
const FOLLOWER_LOG_DIVISOR = 2000;  // followers -> log10(followers/D + 1)
const ENGAGE_LOG_DIVISOR = 5;       // likes+retweets/quotes/replies

type BoardRow = {
  player: string;
  position?: string | null;
  points: number;
  lists: number;
  mentions: number;
};

function startTimeISO(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function buildQuery(): string {
  // NFL Fantasy ranking heuristics with exclusions for other sports
  const must = [
    '( "fantasy rankings" OR "top 10" OR "top 20" OR "my top" OR "must have" OR "must-have" )',
    '( qb OR rb OR wr OR te OR flex OR superflex OR overall OR "fantasy football" OR nfl )',
    'lang:en',
    '-is:retweet'
  ];
  const notSports = [
    "-mlb","-nba","-nhl","-wnba","-mls","-soccer","-nascar","-f1","-formula","-motogp",
    "-premier","-bundesliga","-laliga","-uefa"
  ];
  return [...must, ...notSports].join(" ");
}

type Expanded = Tweet & { user?: User };

function weightFor(tweet: Expanded): number {
  const f = tweet.user?.public_metrics?.followers_count ?? 0;
  const pm = tweet.public_metrics;
  const engage = (pm.like_count ?? 0) + (pm.retweet_count ?? 0) + (pm.quote_count ?? 0) + (pm.reply_count ?? 0);
  const wf = Math.log10(f / FOLLOWER_LOG_DIVISOR + 1);
  const we = Math.log10(engage / ENGAGE_LOG_DIVISOR + 1);
  return BASE_WEIGHT + wf + we;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.max(1, Math.min(Number(searchParams.get("days") ?? 7), 7));
    const limitLists = Math.max(50, Math.min(Number(searchParams.get("max") ?? 300), 500));

    const query = buildQuery();
    const startISO = startTimeISO(days);

    // paginate until we hit limitLists parsed lists
    let next: string | undefined;
    const expanded: Expanded[] = [];
    while (expanded.length < limitLists) {
      const page = await searchRecent({ query, startTimeISO: startISO, nextToken: next, maxResults: 100 });
      const users = new Map<string, User>((page.includes?.users ?? []).map((u) => [u.id, u]));
      for (const t of page.data ?? []) {
        expanded.push({ ...t, user: users.get(t.author_id) });
      }
      if (!page.meta.next_token || (page.data?.length ?? 0) === 0) break;
      next = page.meta.next_token;
    }

    // Parse + store
    let listsParsed = 0;
    for (const tw of expanded) {
      const items = parseRankingList(tw.text);
      const isList = items.length > 0;

      // upsert x_posts
      await dbQuery(
        `
        INSERT INTO x_posts (
          tweet_id, author_id, author_user, author_name, text, created_at,
          like_count, retweet_count, reply_count, quote_count, url, is_list, position_hint
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,$11,$12,$13
        )
        ON CONFLICT (tweet_id) DO UPDATE SET
          text = EXCLUDED.text,
          like_count = EXCLUDED.like_count,
          retweet_count = EXCLUDED.retweet_count,
          reply_count = EXCLUDED.reply_count,
          quote_count = EXCLUDED.quote_count,
          is_list = EXCLUDED.is_list,
          position_hint = EXCLUDED.position_hint
        `,
        [
          tw.id,
          tw.author_id,
          tw.user?.username ?? null,
          tw.user?.name ?? null,
          tw.text,
          new Date(tw.created_at),
          tw.public_metrics.like_count ?? 0,
          tw.public_metrics.retweet_count ?? 0,
          tw.public_metrics.reply_count ?? 0,
          tw.public_metrics.quote_count ?? 0,
          `https://x.com/${tw.user?.username ?? "i"}/status/${tw.id}`,
          isList,
          null,
        ]
      );

      if (!isList) continue;

      // delete old items if we re-saw tweet
      await dbQuery("delete from x_rank_items where tweet_id = $1", [tw.id]);

      const n = items.length;
      const w = weightFor(tw);
      // reverse points with weight
      for (const it of items) {
        const pts = Math.round((n - it.rank + 1) * w);
        await dbQuery(
          `
          insert into x_rank_items (tweet_id, player_name, position, item_rank, overall, points)
          values ($1,$2,$3,$4,$5,$6)
          `,
          [tw.id, it.player, it.position ?? null, it.rank, it.overall, pts]
        );
      }
      listsParsed++;
    }

    // Aggregate last N days
    const agg = await dbQuery<BoardRow>(
      `
      with recent as (
        select ri.player_name as player,
               case
                 when ri.overall then 'OVERALL'
                 else coalesce(upper(ri.position), 'OVERALL')
               end as position,
               ri.points,
               ri.tweet_id
        from x_rank_items ri
        join x_posts p on p.tweet_id = ri.tweet_id
        where p.created_at >= now() - interval '${days} days'
      ),
      sums as (
        select player, position,
               sum(points) as points,
               count(distinct tweet_id) as lists,
               count(*) as mentions
        from recent
        group by player, position
      )
      select player, nullif(position, '') as position, points, lists, mentions
      from sums
      order by points desc
      `
    );

    // split to overall + by-position maps for convenience
    const overall = agg.rows.filter((r) => (r.position ?? "OVERALL") === "OVERALL");
    const byPos = ["QB","RB","WR","TE","DST","K","FLEX","SUPERFLEX"].map((p) => ({
      position: p,
      rows: agg.rows.filter((r) => r.position === p)
    }));

    return NextResponse.json({
      since_days: days,
      parsed_lists: listsParsed,
      totals_considered: expanded.length,
      overall,
      by_position: byPos,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
