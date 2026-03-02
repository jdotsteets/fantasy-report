import { NextRequest, NextResponse } from "next/server";
import { runAllAllowedSourcesIngestWithJob } from "@/lib/ingest";
import { isCronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePositiveInt(v: string | null, fallback: number): number {
  const n = Number(v ?? "");
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const perSourceLimit = Math.min(parsePositiveInt(url.searchParams.get("perSourceLimit"), 50), 250);

  try {
    const { jobId } = await runAllAllowedSourcesIngestWithJob(perSourceLimit);
    return NextResponse.json({ ok: true, queued: true, jobId, perSourceLimit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
