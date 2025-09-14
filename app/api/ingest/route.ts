// app/api/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ingestSourceById, ingestAllSources } from "@/lib/ingest";
import {
  getSourcesHealth,
  getIngestTallies,
  type IngestTalliesBySource,
  type HealthSummary,
} from "@/lib/adminHealth";
import { dbQuery } from "@/lib/db";
import { logIngest } from "@/lib/ingestLogs";
import { INGEST_ENGINE_VERSION } from "@/lib/ingest";
console.log("[ingest] engine", INGEST_ENGINE_VERSION);


export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunCounters = {
  discovered: number;
  upserts: number;
  errors: number;
};

function parseLimit(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : v ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(n, 200));
}

function parseBool(v: string | null): boolean | undefined {
  if (v == null) return undefined;
  const t = v.toLowerCase();
  if (t === "1" || t === "true") return true;
  if (t === "0" || t === "false") return false;
  return undefined;
}

/** Column-aware job summary from ingest_logs. Falls back gracefully if job_id/event/level do not exist. */
async function summarizeFromLogs(params: {
  jobId: string;
  windowSeconds?: number; // used if job_id column is not present
}): Promise<RunCounters> {
  const { jobId, windowSeconds = 300 } = params;

  // Discover available columns once
  const { rows: colRows } = await dbQuery<{ column_name: string }>(
    `select lower(column_name) as column_name
     from information_schema.columns
     where table_name = 'ingest_logs'`
  );
  const colSet = new Set(colRows.map((r) => r.column_name));
  const hasJobId = colSet.has("job_id");

  const filterSql = hasJobId
    ? `where job_id = $1`
    : `where created_at >= now() - ($1 || ' seconds')::interval`;

  const param: unknown[] = [hasJobId ? jobId : String(windowSeconds)];

  // Counters by reason (works even if level/event are missing)
  const sql = `
    select
      sum(case when reason in
        ('ok_insert','ok_update','upsert_inserted','upsert_updated','upsert_skipped','section_captured','static_detected','filtered_out','blocked_by_filter','non_nfl_league','fetch_error','parse_error','scrape_no_matches','invalid_item')
      then 1 else 0 end) as discovered,
      sum(case when reason in ('ok_insert','ok_update','upsert_inserted','upsert_updated') then 1 else 0 end) as upserts,
      sum(case when reason in ('fetch_error','parse_error','scrape_no_matches','invalid_item') then 1 else 0 end) as errors
    from ingest_logs
    ${filterSql}
  `;

  const { rows } = await dbQuery<{ discovered: string | null; upserts: string | null; errors: string | null }>(
    sql,
    param
  );

  const r = rows[0] ?? { discovered: "0", upserts: "0", errors: "0" };
  return {
    discovered: Number(r.discovered ?? "0"),
    upserts: Number(r.upserts ?? "0"),
    errors: Number(r.errors ?? "0"),
  };
}

/** GET: trigger ingest (single or all) + lightweight run summary + optional health. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const sourceIdParam = url.searchParams.get("sourceId");
  const includeHealth = parseBool(url.searchParams.get("includeHealth")) === true;
  const windowHoursParam = url.searchParams.get("windowHours");
  const windowHours = Number.isFinite(Number(windowHoursParam))
    ? Math.max(1, Math.min(Number(windowHoursParam), 24 * 30))
    : 72;

  const jobId = crypto.randomUUID();

  try {
    // Best-effort start log (sourceId 0 means "batch/cron")
    await logIngest({
      sourceId: 0,
      reason: "static_detected",
      detail: sourceIdParam
        ? `ingest GET started for sourceId=${sourceIdParam} limit=${limit}`
        : `ingest GET started for batch limit=${limit}`,
      jobId,
      level: "info",
      event: "start",
    });

    let payload: { result?: unknown; results?: unknown; sources?: number } = {};
    if (sourceIdParam) {
      const sourceId = Number(sourceIdParam);
      if (!Number.isFinite(sourceId)) {
        return NextResponse.json({ error: "Invalid sourceId" }, { status: 400 });
      }
      const result = await ingestSourceById(sourceId, { limit });
      payload = { result, sources: 1 };
    } else {
      const results = await ingestAllSources({ perSourceLimit: limit });
      // try to compute how many sources were attempted
      const sources =
        Array.isArray(results) ? results.length : typeof results === "object" && results !== null ? 1 : 0;
      payload = { results, sources };
    }

    const counters = await summarizeFromLogs({ jobId });

    // Optional health snapshot
    let summary: HealthSummary | undefined;
    if (includeHealth) {
      const { bySource } = await getIngestTallies(windowHours);
      const tallies: IngestTalliesBySource = bySource;
      summary = await getSourcesHealth(windowHours, tallies);
    }

    await logIngest({
      sourceId: 0,
      reason: "static_detected",
      detail: `ingest GET finished: sources=${payload.sources ?? 0} discovered=${counters.discovered} upserts=${counters.upserts} errors=${counters.errors}`,
      jobId,
      level: "info",
      event: "finish",
    });

    return NextResponse.json({
      ok: true,
      jobId,
      limit,
      ...payload,
      counters,
      summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logIngest({
      sourceId: 0,
      reason: "fetch_error",
      detail: `ingest GET failed: ${msg}`,
      jobId,
      level: "error",
      event: "error",
    });
    return NextResponse.json({ ok: false, jobId, error: "Ingestion failed" }, { status: 500 });
  }
}

/** POST: trigger ingest (single or all). Optionally return health summary. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const jobId = crypto.randomUUID();

  try {
    const body = (await req.json().catch(() => ({}))) as {
      sourceId?: number;
      limit?: number;
      includeHealth?: boolean;
      includeErrors?: boolean; // kept for parity, but getSourcesHealth already includes errors
      windowHours?: number;
    };

    const limit = parseLimit(body?.limit);
    const windowHours = Number.isFinite(body?.windowHours)
      ? Math.max(1, Math.min(Number(body.windowHours), 24 * 30))
      : 72;

    await logIngest({
      sourceId: 0,
      reason: "static_detected",
      detail: body?.sourceId
        ? `ingest POST started for sourceId=${body.sourceId} limit=${limit}`
        : `ingest POST started for batch limit=${limit}`,
      jobId,
      level: "info",
      event: "start",
    });

    // Ingest
    let payload: { result?: unknown; results?: unknown; sources?: number };
    if (Number.isFinite(body?.sourceId)) {
      const sourceId = Number(body!.sourceId);
      const result = await ingestSourceById(sourceId, { limit });
      payload = { result, sources: 1 };
    } else {
      const results = await ingestAllSources({ perSourceLimit: limit });
      const sources =
        Array.isArray(results) ? results.length : typeof results === "object" && results !== null ? 1 : 0;
      payload = { results, sources };
    }

    const counters = await summarizeFromLogs({ jobId });

    // Optional health snapshot
    let summary: HealthSummary | undefined;
    if (body?.includeHealth) {
      const { bySource } = await getIngestTallies(windowHours);
      const tallies: IngestTalliesBySource = bySource;
      summary = await getSourcesHealth(windowHours, tallies);
      // if (body?.includeErrors === false) summary.errors = [];
    }

    await logIngest({
      sourceId: 0,
      reason: "static_detected",
      detail: `ingest POST finished: sources=${payload.sources ?? 0} discovered=${counters.discovered} upserts=${counters.upserts} errors=${counters.errors}`,
      jobId,
      level: "info",
      event: "finish",
    });

    return NextResponse.json({
      ok: true,
      jobId,
      limit,
      windowHours,
      ...payload,
      counters,
      summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logIngest({
      sourceId: 0,
      reason: "fetch_error",
      detail: `ingest POST failed: ${msg}`,
      jobId,
      level: "error",
      event: "error",
    });
    return NextResponse.json({ ok: false, jobId, error: "Ingestion failed" }, { status: 500 });
  }
}
