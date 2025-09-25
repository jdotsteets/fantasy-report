// app/api/waivers/route.ts
import { NextResponse } from "next/server";
import { dbQueryRows } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const weekParam = u.searchParams.get("week");
  const week = weekParam ? parseInt(weekParam, 10) : null;

  const rows = await dbQueryRows<{
    player_key: string;
    full_name: string | null;
    position: string | null;
    team: string | null;
    articles: number;
    score: number;
  }>(
    `
    select player_key, full_name, position, team, articles, score
    from waiver_consensus
    ${week == null ? "" : "where week = $1"}
    order by score desc, articles desc, full_name asc
    limit 100
    `,
    week == null ? [] : [week]
  );

  return NextResponse.json({ ok: true, week, items: rows });
}
