import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get("team");
  const limit = parseInt(url.searchParams.get("limit") || "10");

  try {
    let query = `
      SELECT 
        id, transaction_date, team_key, team_name,
        player_name, position, transaction_type_normalized,
        transaction_type_raw, details, source_url
      FROM transactions
    `;
    
    const params: any[] = [];
    
    if (teamId) {
      query += ` WHERE team_key = $1`;
      params.push(teamId.toUpperCase());
    }
    
    query += ` ORDER BY transaction_date DESC, created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await dbQuery(query, params);

    return NextResponse.json({
      transactions: rows.map(r => ({
        id: r.id,
        date: r.transaction_date,
        team: r.team_name,
        teamKey: r.team_key,
        player: r.player_name,
        position: r.position,
        type: r.transaction_type_normalized,
        typeRaw: r.transaction_type_raw,
        details: r.details,
        sourceUrl: r.source_url,
      })),
      count: rows.length,
    });
  } catch (error) {
    console.error("Failed to fetch transactions:", error);
    return NextResponse.json({ transactions: [], count: 0 });
  }
}