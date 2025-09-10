// app/api/home/static/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StaticType =
  | "rankings_ros"
  | "rankings_weekly"
  | "dfs_tools"
  | "projections"
  | "waiver_wire"
  | "stats";

const ALLOWED: ReadonlyArray<StaticType> = [
  "rankings_ros",
  "rankings_weekly",
  "dfs_tools",
  "projections",
  "waiver_wire",
  "stats",
];

// Normalize dbQuery results (T[] or { rows: T[] })
function toRows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const obj = res as { rows?: unknown };
  return Array.isArray(obj?.rows) ? (obj.rows as T[]) : [];
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const type = (u.searchParams.get("type") || "rankings_ros") as StaticType;
    const sport = u.searchParams.get("sport") || "nfl";
    const limit = Math.min(Math.max(parseInt(u.searchParams.get("limit") || "12", 10), 1), 50);

    if (!ALLOWED.includes(type)) {
      return NextResponse.json({ ok: false, error: "Invalid static type" }, { status: 400 });
    }

    const res = await dbQuery<{
      id: number;
      title: string | null;
      url: string | null;
      discovered_at: string | null;
    }>(
      `
      SELECT id, title, url, discovered_at
      FROM articles
      WHERE is_static = TRUE
        AND static_type = $1
        AND (sport IS NULL OR sport = $2)
      ORDER BY popularity_score DESC NULLS LAST,
               discovered_at DESC NULLS LAST,
               id DESC
      LIMIT $3
      `,
      [type, sport, limit]
    );

    const items = toRows(res);
    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Return 200 with empty items so the client can still render gracefully,
    // but include an error field for debugging in the UI.
    return NextResponse.json({ ok: false, error: msg, items: [] as unknown[] }, { status: 200 });
  }
}
