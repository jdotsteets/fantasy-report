import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sourceId = Number(searchParams.get("sourceId"));
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit")) || 10, 50));

  if (!Number.isFinite(sourceId)) {
    return NextResponse.json({ ok: false, error: "invalid_source" }, { status: 400 });
  }

  const rows = (
    await dbQuery<{ url: string; title: string | null; discovered_at: string }>(
      `select url, title, discovered_at
         from articles
        where source_id = $1
        order by discovered_at desc
        limit $2`,
      [sourceId, limit]
    )
  ).rows;

  return NextResponse.json(rows);
}
