import { NextRequest, NextResponse } from "next/server";
import { createJob, appendEvent, setProgress, finishJobSuccess, failJob } from "@/lib/jobs";
import { runIngestOnce } from "@/lib/ingestRunner";

type Body = {
  sourceId?: number | string;
  limit?: number | string;
  debug?: boolean | string;
  sport?: string | null;
};

function toInt(val: number | string | undefined): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim() !== "") {
    const n = Number(val);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toBool(val: boolean | string | undefined): boolean | undefined {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    if (val.toLowerCase() === "true") return true;
    if (val.toLowerCase() === "false") return false;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceId = toInt(body.sourceId);
  const limit = toInt(body.limit) ?? 50;
  const debug = toBool(body.debug) ?? false;
  const sport = typeof body.sport === "string" ? body.sport : null;

  const job = await createJob("ingest", { sourceId, limit, debug, sport }, "admin");

  try {
    await appendEvent(job.id, "info", "Ingest started", { sourceId, limit, debug, sport });

    let processed = 0;
    for await (const step of runIngestOnce({ sourceId, limit, debug, sport, jobId: job.id })) {
      if (step.delta) {
        processed += step.delta;
        await setProgress(job.id, processed);
      }
      await appendEvent(job.id, step.level, step.message, step.meta);
    }

    await finishJobSuccess(job.id, "Ingest finished");
    return NextResponse.json({ ok: true, job_id: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await appendEvent(job.id, "error", "Ingest failed", { error: message });
    await failJob(job.id, message);
    return NextResponse.json({ ok: false, job_id: job.id, error: message }, { status: 500 });
  }
}
