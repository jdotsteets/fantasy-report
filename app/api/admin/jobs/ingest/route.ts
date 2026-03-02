// app/api/admin/jobs/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createJob, appendEvent, setProgress, finishJobSuccess, failJob } from "@/lib/jobs";
import { runIngestOnce } from "@/lib/ingestRunner"; // you’ll wire your existing ingest here

type Body = {
  sourceId?: number;
  limit?: number;
  debug?: boolean;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const sourceId = body.sourceId ?? undefined;
  const limit = body.limit ?? 50;
  const debug = body.debug ?? false;

  // create job
  const job = await createJob("ingest", { sourceId, limit, debug }, "admin");

  try {
    await appendEvent(job.id, "info", "Ingest started", { sourceId, limit });

    // Optional: set total if you can estimate upfront
    // await setProgress(job.id, 0, limit);

    // Example runner that yields steps; see section 4
    let processed = 0;
    for await (const step of runIngestOnce({ sourceId, limit, debug })) {
      processed += step.delta;
      await setProgress(job.id, processed);
      await appendEvent(job.id, step.level, step.message, step.meta);
    }

    await finishJobSuccess(job.id, "Ingest finished");
    return NextResponse.json({ ok: true, job_id: job.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    await appendEvent(job.id, "error", "Ingest failed", { error: msg });
    await failJob(job.id, msg);
    return NextResponse.json({ ok: false, job_id: job.id, error: msg }, { status: 500 });
  }
}
