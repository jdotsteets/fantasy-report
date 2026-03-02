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

// normalize dbQuery results: T[] or { rows: T[] }
function toRows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const obj = res as { rows?: unknown };
  return Array.isArray(obj?.rows) ? (obj.rows as T[]) : [];
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const type = (u.searchParams.get("type") || "rankings_ros") as StaticType;
    const sportRaw = (u.searchParams.get("sport") || "nfl").toLowerCase();
    const limit = Math.min(Math.max(parseInt(u.searchParams.get("limit") || "12", 10), 1), 50);

    if (!ALLOWED.includes(type)) {
      return NextResponse.json({ ok: false, error: "Invalid static type", items: [] }, { status: 400 });
    }

    // 1) Try with sport filter (case-insensitive, robust to whitespace)
    const withSport = await dbQuery<{
      id: number;
      title: string | null;
      url: string | null;
      discovered_at: string | null;
    }>(
      `
      SELECT id, title, url, discovered_at
      FROM articles
      WHERE is_static = TRUE
        AND lower(trim(static_type)) = lower($1)
        AND (sport IS NULL OR lower(trim(sport)) = $2)
      ORDER BY discovered_at DESC NULLS LAST, id DESC
      LIMIT $3
      `,
      [type, sportRaw, limit]
    );

    let items = toRows(withSport);

    // 2) Fallback: if nothing matched the sport (e.g., different sport labels), return by type only
    if (items.length === 0) {
      const noSport = await dbQuery<{
        id: number;
        title: string | null;
        url: string | null;
        discovered_at: string | null;
      }>(
        `
        SELECT id, title, url, discovered_at
        FROM articles
        WHERE is_static = TRUE
          AND lower(trim(static_type)) = lower($1)
        ORDER BY discovered_at DESC NULLS LAST, id DESC
        LIMIT $2
        `,
        [type, limit]
      );
      items = toRows(noSport);
    }

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, items: [] }, { status: 200 });
  }
}
