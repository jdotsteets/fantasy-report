// app/api/home/static/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = ["iad1"]; // match your DB/pooler region

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

/* ───────────────────────── Utils ───────────────────────── */

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`route deadline ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

type ResultLike<T> = T[] | { rows?: T[] };

function toRows<T>(res: unknown): T[] {
  const v = res as ResultLike<T>;
  if (Array.isArray(v)) return v;
  return Array.isArray(v.rows) ? v.rows : [];
}

/* ───────────────────────── Route ───────────────────────── */

export async function GET(req: Request) {
  try {
    // Keep pool warm / connectivity check
    await withDeadline(dbQuery("select 1", []), 8000);

    const u = new URL(req.url);
    const type = ((u.searchParams.get("type") || "rankings_ros") as StaticType);
    const sport = u.searchParams.get("sport") || "nfl";
    const limit = Math.min(Math.max(parseInt(u.searchParams.get("limit") || "12", 10), 1), 50);

    if (!ALLOWED.includes(type)) {
      return NextResponse.json({ ok: false, error: "Invalid static type" }, { status: 400 });
    }

    type Row = {
      id: number;
      title: string | null;
      url: string | null;
      discovered_at: string | null;
    };

    const res = await dbQuery<Row>(
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

    const rows = toRows<Row>(res);

    return NextResponse.json({ ok: true, items: rows });
  } catch {
    // 503 so vercel/clients back off instead of stampeding
    return NextResponse.json(
      { error: "temporarily unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "max-age=0, s-maxage=15, stale-while-revalidate=60" },
      }
    );
  }
}
