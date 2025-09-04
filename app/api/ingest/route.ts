// app/api/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ingestSourceById, ingestAllSources } from "@/lib/ingest";
import {
  getSourcesHealth,
  getIngestTallies,
  type IngestTalliesBySource,
  type HealthSummary,
} from "@/lib/adminHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseLimit(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : v ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(n, 200));
}

/** GET: trigger ingest (single or all). No health summary. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const searchParams = new URL(req.url).searchParams;

  const limit = parseLimit(searchParams.get("limit"));
  const sourceIdParam = searchParams.get("sourceId");

  try {
    if (sourceIdParam) {
      const sourceId = Number(sourceIdParam);
      if (!Number.isFinite(sourceId)) {
        return NextResponse.json({ error: "Invalid sourceId" }, { status: 400 });
      }
      // ingestSourceById expects { limit }
      const result = await ingestSourceById(sourceId, { limit });
      return NextResponse.json({ sourceId, limit, result });
    }

    // ingestAllSources expects { perSourceLimit }
    const results = await ingestAllSources({ perSourceLimit: limit });
    return NextResponse.json({ limit, results });
  } catch (err) {
    console.error("[/api/ingest GET] error:", err);
    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}

/** POST: trigger ingest (single or all). Optionally return health summary. */
export async function POST(req: NextRequest): Promise<NextResponse> {
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

    // Ingest
    let payload: { result?: unknown; results?: unknown };
    if (Number.isFinite(body?.sourceId)) {
      const sourceId = Number(body!.sourceId);
      // ingestSourceById expects { limit }
      const result = await ingestSourceById(sourceId, { limit });
      payload = { result };
    } else {
      // ingestAllSources expects { perSourceLimit }
      const results = await ingestAllSources({ perSourceLimit: limit });
      payload = { results };
    }

    // Optional health snapshot
    let summary: HealthSummary | undefined;
    if (body?.includeHealth) {
      const { bySource } = await getIngestTallies(windowHours);
      const tallies: IngestTalliesBySource = bySource;
      summary = await getSourcesHealth(windowHours, tallies);
      // if (body?.includeErrors === false) summary.errors = [];
    }

    return NextResponse.json({
      ok: true,
      limit,
      windowHours,
      ...payload,
      summary,
    });
  } catch (err) {
    console.error("[/api/ingest POST] error:", err);
    return NextResponse.json({ ok: false, error: "Ingestion failed" }, { status: 500 });
  }
}
