// app/api/ingest/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import {
  ingestSourceById,
  ingestAllSources,
  ingestAllAllowedSources,
  runSingleSourceIngestWithJob,
  runAllAllowedSourcesIngestWithJob,
} from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;



function clampInt(val: string | null, def: number, min: number, max: number): number {
  const n = val ? Number(val) : def;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

async function fetchRecentLogsForSource(
  sourceId: number,
  limit = 25
): Promise<Array<{ created_at: string; reason: string; detail: string | null; url?: string; title?: string; domain?: string }>> {
  const rs = await dbQuery<{
    created_at: string;
    reason: string;
    detail: string | null;
    url?: string;
    title?: string;
    domain?: string;
  }>(
    `SELECT created_at::text, reason, detail, url, title, domain
       FROM ingest_logs
      WHERE source_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [sourceId, limit]
  );
  return rs.rows ?? [];
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const action = (url.searchParams.get("action") || "all").toLowerCase();
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 500);
  const perSourceLimit = clampInt(url.searchParams.get("perSourceLimit"), limit, 1, 500);
  const includeLogs = url.searchParams.get("logs") === "1";
  const mode = (url.searchParams.get("mode") || "").toLowerCase();
  const useJob = mode === "job" || mode === "background";


  // ?action=debug&sourceId=3136
if (action === "debug") {
  const sid = Number(url.searchParams.get("sourceId") || 0);
  const q = await dbQuery<{
    db: string | null;
    schema: string | null;
    sources_count: number;
    has_source: boolean;
  }>(`
    SELECT current_database() AS db,
           current_schema()   AS schema,
           (SELECT COUNT(*)::int FROM sources)        AS sources_count,
           EXISTS(SELECT 1 FROM sources WHERE id=$1)  AS has_source
  `, [sid]);
  return NextResponse.json(q.rows?.[0] ?? null);
}


// inside the GET handler, before other branches:
if (action === "debug") {
  const sid = Number(url.searchParams.get("sourceId") || 0);
  const row = await dbQuery<{
    db: string | null;
    schema: string | null;
    sources_count: number;
    has_3136: boolean;
  }>(`
    SELECT current_database() AS db,
           current_schema() AS schema,
           (SELECT COUNT(*)::int FROM sources) AS sources_count,
           EXISTS(SELECT 1 FROM sources WHERE id = $1) AS has_3136
  `, [sid]);

  return NextResponse.json(row.rows?.[0] ?? null);
}

  try {
    // ──────────────────────────────────────────────────────────────
    // Ingest a single source: ?action=source&sourceId=123[&mode=job][&logs=1]
    // ──────────────────────────────────────────────────────────────
    if (action === "source") {
      const sourceId = Number(url.searchParams.get("sourceId"));
      if (!Number.isFinite(sourceId) || sourceId <= 0) {
        return NextResponse.json({ ok: false, error: "Missing or invalid sourceId" }, { status: 400 });
      }

      if (useJob) {
        // Background job
        const { jobId, summary } = await runSingleSourceIngestWithJob(sourceId, limit);
        return NextResponse.json({ ok: true, action, jobId, summary });
      }

      // Inline (synchronous)
      const summary = await ingestSourceById(sourceId, { limit });
      const logs = includeLogs ? await fetchRecentLogsForSource(sourceId) : undefined;

      // IMPORTANT: return ok:true even if inserted=0 (e.g., non_nfl_guard skips)
      return NextResponse.json({ ok: true, action, sourceId, summary, ...(includeLogs ? { logs } : {}) });
    }

    // ──────────────────────────────────────────────────────────────
    // Ingest all *allowed* sources: ?action=allowed[&mode=job]
    // ──────────────────────────────────────────────────────────────
    if (action === "allowed") {
      if (useJob) {
        const { jobId } = await runAllAllowedSourcesIngestWithJob(perSourceLimit);
        return NextResponse.json({ ok: true, action, jobId, perSourceLimit });
      }
      await ingestAllAllowedSources({ perSourceLimit });
      return NextResponse.json({ ok: true, action, perSourceLimit });
    }

    // ──────────────────────────────────────────────────────────────
    // Ingest ALL sources (allowed or not): ?action=all
    // (kept for parity with your previous API; runs inline)
    // ──────────────────────────────────────────────────────────────
    if (action === "all") {
      await ingestAllSources({ perSourceLimit });
      return NextResponse.json({ ok: true, action, perSourceLimit });
    }

    return NextResponse.json({ ok: false, error: `Unknown action '${action}'` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/ingest] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
