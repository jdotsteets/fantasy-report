// app/api/admin/sources/recent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("sourceId"));
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 10, 25));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ items: [] });
  }

  const rows = (
    await dbQuery<{
      title: string | null;
      url: string;
      discovered_at: string | null;
    }>(
      `
      SELECT title, url, discovered_at
      FROM articles
      WHERE source_id = $1
      ORDER BY discovered_at DESC NULLS LAST
      LIMIT $2
      `,
      [id, limit]
    )
  ).rows;

  return NextResponse.json({
    items: rows.map((r) => ({
      title: r.title ?? null,
      url: r.url,
      discovered_at: r.discovered_at,
    })),
  });
}
