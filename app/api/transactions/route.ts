import { NextResponse } from "next/server";
import { dbQuery } from "../../../lib/db";

export const dynamic = "force-dynamic";

type TransactionRow = {
  id: number;
  transaction_date: string | Date;
  team_key: string | null;
  team_name: string | null;
  player_name: string | null;
  position: string | null;
  transaction_type_normalized: string | null;
  transaction_type_raw: string | null;
  details: string | null;
  source_url: string | null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get("team");
  const limitParam = Number.parseInt(url.searchParams.get("limit") || "10", 10);
  const limit = Number.isNaN(limitParam) ? 10 : limitParam;

  try {
    let query = `
      SELECT 
        id,
        transaction_date,
        team_key,
        team_name,
        player_name,
        position,
        transaction_type_normalized,
        transaction_type_raw,
        details,
        source_url
      FROM transactions
    `;

    const params: Array<string | number> = [];

    if (teamId) {
      query += ` WHERE team_key = $1`;
      params.push(teamId.toUpperCase());
    }

    query += ` ORDER BY transaction_date DESC, created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await dbQuery(query, params);
    const rows = result.rows as TransactionRow[];

    return NextResponse.json({
      transactions: rows.map((r: TransactionRow) => ({
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
    return NextResponse.json({ transactions: [], count: 0 }, { status: 500 });
  }
}