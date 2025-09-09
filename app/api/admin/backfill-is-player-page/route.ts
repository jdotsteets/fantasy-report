// app/api/admin/backfill-is-player-page/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || "";
  if (secret && (req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { rowCount } = await dbQuery(`
    UPDATE articles a
    SET is_player_page = TRUE
    WHERE is_player_page IS NOT TRUE
      AND (
        a.url ~* '(fantasypros\\.com/.*/nfl/(players|stats|news)/[a-z0-9-]+\\.php)'
     OR a.url ~* '(nbcsports\\.com/.*/nfl/[a-z0-9-]+/(\\d+|[0-9a-f-]{36}))'
     OR a.url ~* '(sports\\.yahoo\\.com/.*/nfl/players/\\d+)'
     OR a.url ~* '(espn\\.com/nfl/player/_/id/\\d+)'
     OR a.url ~* '(pro-football-reference\\.com/players/[A-Z]/[A-Za-z0-9]+\\.htm)'
     OR a.url ~* '(rotowire\\.com/football/player/[a-z0-9-]+-\\d+)'
     OR COALESCE(a.cleaned_title, a.title) ~ '^[A-Z][A-Za-z.''-]+( [A-Z][A-Za-z.''-]+){0,3}( (?:Jr|Sr|II|III|IV)\\.?)?$'
      )
  `);

  return NextResponse.json({ ok: true, updated: rowCount ?? 0 });
}