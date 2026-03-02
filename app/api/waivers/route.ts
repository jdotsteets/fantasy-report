// app/api/waivers/route.ts
import { NextResponse } from "next/server";
import { dbQueryRows } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

type Row = {
  player_key: string;
  player_name: string | null;
  role: string | null;         // raw role from waiver_mentions
  articles: number;
  score: number;               // computed in SQL
};

type RankedItem = {
  playerKey: string;
  name: string;
  pos: Pos | null;
  team: null;                  // team not available in waiver_mentions
  articles: number;
  score: number;
  rankOverall: number;
  rankPos: number | null;
};

function normPos(raw?: string | null): Pos | null {
  if (!raw) return null;
  const up = raw.toUpperCase().replace(/\s+/g, "");
  if (up === "D/ST" || up === "DST" || up === "DEF" || up === "DEFENSE") return "DST";
  if (up === "QB" || up === "RB" || up === "WR" || up === "TE" || up === "K") return up;
  return null;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const weekParam = u.searchParams.get("week");
  const limitParam = u.searchParams.get("limit");
  const limit = Math.max(1, Math.min(500, limitParam ? parseInt(limitParam, 10) : 100));

  // If week not provided, use latest week in waiver_mentions
  let week: number | null = weekParam ? parseInt(weekParam, 10) : null;
  if (week == null || Number.isNaN(week)) {
    const latest = await dbQueryRows<{ week: number | null }>(
      `select max(week) as week from waiver_mentions`
    );
    week = latest[0]?.week ?? null;
  }

  if (week == null) {
    return NextResponse.json({
      ok: true,
      week: null,
      meta: { total: 0, positions: {} as Record<string, number>, limit },
      overall: [] as RankedItem[],
      byPosition: { QB: [], RB: [], WR: [], TE: [], K: [], DST: [] } as Record<Pos, RankedItem[]>,
    });
  }

  // Aggregate across all sources from waiver_mentions
  // score formula (per mention):
  //   1.0
  // + rank bonus: (11 - LEAST(rank_hint,10)) * 0.1   →  top ranks get more (1.0..0.1)
  // + confidence bonus: LEAST(GREATEST(confidence,0),5) * 0.05  → up to +0.25
  const rows = await dbQueryRows<Row>(
    `
    with agg as (
      select
        player_key,
        max(player_name) as player_name,
        role,
        count(*)::int as articles,
        sum(
          1.0
          + case
              when rank_hint is not null
                then (11 - LEAST(rank_hint, 10)) * 0.1
              else 0.0
            end
          + (LEAST(GREATEST(coalesce(confidence,0), 0), 5) * 0.05)
        )::float as score
      from waiver_mentions
      where week = $1
      group by player_key, role
    )
    select player_key, player_name, role, articles, score
    from agg
    order by score desc, articles desc, player_name asc
    limit 1000
    `,
    [week]
  );

  // Build overall list with overall rank
  const overall: RankedItem[] = rows.map((r, i) => ({
    playerKey: r.player_key,
    name: r.player_name ?? "",
    pos: normPos(r.role),
    team: null,
    articles: r.articles,
    score: r.score,
    rankOverall: i + 1,
    rankPos: null,
  }));

  // Group by position and compute per-position rank
  const byPosition: Record<Pos, RankedItem[]> = { QB: [], RB: [], WR: [], TE: [], K: [], DST: [] };
  for (const item of overall) {
    if (item.pos) byPosition[item.pos].push(item);
  }
  (Object.keys(byPosition) as Pos[]).forEach((p) => {
    byPosition[p].forEach((item, idx) => {
      item.rankPos = idx + 1;
    });
  });

  // Trim to requested limit
  const trimmedOverall = overall.slice(0, limit);
  const trimmedByPosition = (Object.keys(byPosition) as Pos[]).reduce(
    (acc, p) => {
      acc[p] = byPosition[p].slice(0, limit);
      return acc;
    },
    {} as Record<Pos, RankedItem[]>
  );

  const positionsMeta: Record<string, number> = {};
  (Object.keys(byPosition) as Pos[]).forEach((p) => {
    positionsMeta[p] = byPosition[p].length;
  });

  return NextResponse.json({
    ok: true,
    week,
    meta: { total: overall.length, positions: positionsMeta, limit },
    overall: trimmedOverall,
    byPosition: trimmedByPosition,
  });
}
