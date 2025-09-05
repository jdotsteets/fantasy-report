import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

type Cols = { hasJobId: boolean; hasLevel: boolean; hasEvent: boolean };
let cachedCols: Cols | null = null;

async function getCols(): Promise<Cols> {
  if (cachedCols) return cachedCols;
  const { rows } = await dbQuery<{ column_name: string }>(
    `select lower(column_name) as column_name
     from information_schema.columns
     where table_name = 'ingest_logs'`
  );
  const names = new Set(rows.map((r) => r.column_name));
  cachedCols = {
    hasJobId: names.has("job_id"),
    hasLevel: names.has("level"),
    hasEvent: names.has("event"),
  };
  return cachedCols;
}

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "30");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 30;
    const cols = await getCols();

    const whereParts: string[] = [];
    const params: unknown[] = [];

    if (cols.hasJobId && jobId) {
      whereParts.push(`job_id = $${params.length + 1}`);
      params.push(jobId);
    }
    const whereSql = whereParts.length ? `where ${whereParts.join(" and ")}` : "";

    const selLevel = cols.hasLevel ? `level` : `NULL::text as level`;
    const selEvent = cols.hasEvent ? `event` : `NULL::text as event`;

    const sql = `
      select created_at, ${selLevel}, ${selEvent}, reason, detail, url, title
      from ingest_logs
      ${whereSql}
      order by created_at desc
      limit $${params.length + 1}
    `;
    params.push(limit);

    const { rows } = await dbQuery<{
      created_at: string;
      level: string | null;
      event: string | null;
      reason: string | null;
      detail: string | null;
      url: string | null;
      title: string | null;
    }>(sql, params);

    return NextResponse.json({ logs: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
