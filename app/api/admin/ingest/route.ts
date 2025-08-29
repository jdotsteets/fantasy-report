// app/api/admin/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ingestAllSources } from "@/lib/ingest";
import {
  getSourcesHealth,
  getSourceErrorDigests,
  type HealthSummary,
} from "@/lib/adminHealth";

const okKey = (req: NextRequest) => {
  const want = process.env.ADMIN_KEY ?? "";
  const got = req.headers.get("x-admin-key") ?? "";
  return want && got && got === want;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!okKey(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const u = new URL(req.url);
  const q = u.searchParams;

  // try body, then query
  let body: any = {};
  try { body = await req.json(); } catch {}

  const limit = Number(q.get("limit") ?? body.limit ?? 50);
  const windowHours = Math.max(1, Number(q.get("windowHours") ?? 72));
  const includeHealth = (q.get("includeHealth") ?? "0") === "1";
  const includeErrors = (q.get("includeErrors") ?? "0") === "1";

  // If your ingestAllSources supports an optional sourceId, you can plumb it through:
  // const sourceId = Number(q.get("sourceId") ?? body.sourceId ?? NaN);
  // const res = await ingestAllSources(limit, Number.isFinite(sourceId) ? sourceId : undefined);
  const res = await ingestAllSources(limit);

  if (includeHealth) {
    const tallies: Record<number, { inserted: number; updated: number; skipped: number }> = {};
    for (const [k, v] of Object.entries(res)) {
      const id = Number(k);
      tallies[id] = { inserted: v.inserted, updated: v.updated, skipped: v.skipped };
    }
    const summary: HealthSummary = await getSourcesHealth(windowHours, tallies);
    if (includeErrors) {
      summary.errors = await getSourceErrorDigests(windowHours);
    }
    return NextResponse.json({ ok: true, task: "ingest", res, summary });
  }

  return NextResponse.json({ ok: true, task: "ingest", res });
}
