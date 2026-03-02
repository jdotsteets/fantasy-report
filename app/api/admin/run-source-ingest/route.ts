//app/api/admin/run-source-ingest/route.ts


import { NextRequest, NextResponse } from "next/server";
import { runSingleSourceIngestWithJob } from "@/lib/ingest";

type ReqBody = {
  sourceId: number;
  limit?: number;
};

export const runtime = "nodejs"; // ensure Node runtime for long-running job

export async function POST(req: NextRequest): Promise<Response> {
  let body: ReqBody | null = null;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body.sourceId !== "number") {
    return NextResponse.json({ ok: false, error: "`sourceId` (number) is required" }, { status: 400 });
  }

  const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : 50;

  try {
    const { jobId, summary } = await runSingleSourceIngestWithJob(body.sourceId, limit);
    return NextResponse.json({ ok: true, jobId, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
