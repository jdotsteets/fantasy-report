import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

type Cols = { hasJobId: boolean; hasEvent: boolean };
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
    hasEvent: names.has("event"),
  };
  return cachedCols;
}

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    const cols = await getCols();

    const params: unknown[] = [];
    const whereSql = cols.hasJobId && jobId ? `where job_id = $${params.push(jobId)}` : "";

    // Reason-based counters (works even if level/event columns are missing)
    const countsSql = `
      select
        sum(case when reason in ('ok_insert','ok_update','upsert_inserted','upsert_updated','upsert_skipped','section_captured','static_detected') then 1 else 0 end) as discovered,
        sum(case when reason in ('ok_insert','ok_update','upsert_inserted','upsert_updated') then 1 else 0 end) as upserts,
        sum(case when reason in ('fetch_error','parse_error','scrape_no_matches','invalid_item','filtered_out') then 1 else 0 end) as errors,
        max(created_at) as last_at
      from ingest_logs
      ${whereSql}
    `;
    const { rows } = await dbQuery<{
      discovered: string | null;
      upserts: string | null;
      errors: string | null;
      last_at: string | null;
    }>(countsSql, params);

    let done = false;
    if (cols.hasEvent && cols.hasJobId && jobId) {
      const finSql = `select 1 from ingest_logs where job_id = $1 and event = 'finish' limit 1`;
      const fin = await dbQuery(finSql, [jobId]);
      done = fin.rows.length > 0;
    } else {
      // Best-effort fallback: no new logs for ~5s => treat as finished
      const lastAt = rows[0]?.last_at ? Date.parse(rows[0].last_at) : NaN;
      if (!Number.isNaN(lastAt)) done = Date.now() - lastAt > 5000;
    }

    const r = rows[0] ?? { discovered: "0", upserts: "0", errors: "0", last_at: null };

    return NextResponse.json({
      discovered: Number(r.discovered ?? "0"),
      upserts: Number(r.upserts ?? "0"),
      errors: Number(r.errors ?? "0"),
      lastAt: r.last_at,
      done,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
