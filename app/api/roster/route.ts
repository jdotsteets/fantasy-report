import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

// Cache for 5 minutes to avoid repeated DB queries
const cache = new Map<string, { data: string[], timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const team = searchParams.get("team")?.toUpperCase();

  if (!team) {
    return NextResponse.json({ error: "Missing team parameter" }, { status: 400 });
  }

  // Check cache
  const cached = cache.get(team);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ team, players: cached.data });
  }

  try {
    const result = await dbQuery(
      `SELECT full_name, search_names 
       FROM players 
       WHERE team = $1 AND active = true`,
      [team]
    );

    // Flatten all player names and search variations
    const names = new Set<string>();
    result.rows.forEach((row: any) => {
      if (row.full_name) names.add(row.full_name.toLowerCase());
      if (row.search_names && Array.isArray(row.search_names)) {
        row.search_names.forEach((n: string) => names.add(n.toLowerCase()));
      }
    });

    const playerList = Array.from(names);

    // Update cache
    cache.set(team, { data: playerList, timestamp: Date.now() });

    return NextResponse.json({ team, players: playerList, count: playerList.length });
  } catch (error) {
    console.error("Failed to fetch roster:", error);
    return NextResponse.json(
      { error: "Failed to fetch roster" },
      { status: 500 }
    );
  }
}