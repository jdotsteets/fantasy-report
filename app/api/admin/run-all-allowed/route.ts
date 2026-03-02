import { NextRequest, NextResponse } from "next/server";
import { runAllAllowedSourcesIngestWithJob } from "@/lib/ingest";

type ReqBody = { perSourceLimit?: number };

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  let body: ReqBody | null = null;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    /* noop – body can be empty */
  }

  const perSourceLimit =
    body && typeof body.perSourceLimit === "number" && body.perSourceLimit > 0
      ? body.perSourceLimit
      : 50;

  try {
    const { jobId } = await runAllAllowedSourcesIngestWithJob(perSourceLimit);
    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
