// app/api/db-debug/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

type Row = {
  db: string | null;
  schema: string | null;
  sources_count: number;
  has_source: boolean;
  source_name: string | null;
  source_provider: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sid = Number(url.searchParams.get("sourceId") ?? 0);

    const { rows } = await dbQuery<Row>(`
      WITH s AS (
        SELECT
          EXISTS(SELECT 1 FROM sources WHERE id = $1) AS has_source,
          (SELECT name     FROM sources WHERE id = $1) AS source_name,
          (SELECT provider FROM sources WHERE id = $1) AS source_provider
      )
      SELECT
        current_database() AS db,
        current_schema()   AS schema,
        (SELECT COUNT(*)::int FROM sources) AS sources_count,
        (SELECT has_source      FROM s)     AS has_source,
        (SELECT source_name     FROM s)     AS source_name,
        (SELECT source_provider FROM s)     AS source_provider
    `, [sid]);

    return NextResponse.json(rows?.[0] ?? null, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[db-debug] error", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
