// app/api/player-updates/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  const params: (string|number)[] = [];
  let where = "";
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where = "WHERE LOWER(player_name) ILIKE $1 OR player_slug ILIKE $1";
  }
  const sql = `
    SELECT player_slug, player_name, updates, last_update
    FROM player_updates
    ${where}
    ORDER BY last_update DESC
    LIMIT 50
  `;
  const r = await dbQuery(sql, params);
  return NextResponse.json({ items: r.rows });
}
