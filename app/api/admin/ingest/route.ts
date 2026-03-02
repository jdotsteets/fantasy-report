// app/api/admin/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createJob, appendEvent, setProgress, finishJobSuccess, failJob } from "@/lib/jobs";
import { runIngestOnce } from "@/lib/ingestRunner";
import { logIngest } from "@/lib/ingestLogs";
import type { ProbeMethod } from "@/lib/sources/types";

type Body = {
  sourceId?: number | string;
  limit?: number | string;
  debug?: boolean | string;
  sport?: string | null;
  jobId?: string | null;             // optional tracking id from commit route
  method?: ProbeMethod | string | null; // optional, if you choose to pass it
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
    const v = val.toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

function toMethod(val: unknown): ProbeMethod | undefined {
  return val === "rss" || val === "scrape" || val === "adapter" ? val : undefined;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceId = toInt(body.sourceId);
  if (!sourceId) {
    return NextResponse.json({ ok: false, error: "Missing sourceId" }, { status: 400 });
  }

  const limit = toInt(body.limit) ?? 50;
  const debug = toBool(body.debug) ?? false;
  const sport = typeof body.sport === "string" ? body.sport : null;
  const method = toMethod(body.method ?? undefined);
  // Prefer the external jobId from the commit route if provided; otherwise use our internal job id.
  // We’ll compute the final value after createJob so we can fall back to job.id.
  const externalJobId = body.jobId ?? null;

  const job = await createJob(
    "ingest",
    { sourceId, limit, debug, sport, method, externalJobId },
    "admin"
  );

  // The jobId we pass down to the runner / logs (string for consistency)
  const trackingJobId = externalJobId ?? String(job.id);

  try {
    // Admin job timeline
    await appendEvent(job.id, "info", "Ingest started", {
      sourceId,
      limit,
      debug,
      sport,
      method: method ?? null,
      jobId: trackingJobId,
    });

    // Log start to ingest_logs
    await logIngest({
      sourceId,
      reason: "static_detected",
      detail: "ingest started",
      jobId: trackingJobId,
      level: "info",
      event: "start",
    });

    // Run ingest (streaming progress)
    let processed = 0;
    for await (const step of runIngestOnce({
      sourceId,
      limit,
      debug,
      sport,
      method,
      jobId: trackingJobId,
    })) {
      if (step.delta) {
        processed += step.delta;
        await setProgress(job.id, processed);
      }
      await appendEvent(job.id, step.level ?? "info", step.message, {
        ...(step.meta ?? {}),
        jobId: trackingJobId,
      });
    }

    // Log finish
    await logIngest({
      sourceId,
      reason: "static_detected",
      detail: "ingest finished",
      jobId: trackingJobId,
      level: "info",
      event: "finish",
    });

    await finishJobSuccess(job.id, "Ingest finished");
    return NextResponse.json({ ok: true, job_id: job.id, jobId: trackingJobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";

    await appendEvent(job.id, "error", "Ingest failed", { error: message, jobId: trackingJobId });

    // Error line in ingest_logs
    await logIngest({
      sourceId,
      reason: "fetch_error",
      detail: message,
      jobId: trackingJobId,
      level: "error",
      event: "error",
    });

    await failJob(job.id, message);
    return NextResponse.json(
      { ok: false, job_id: job.id, jobId: trackingJobId, error: message },
      { status: 500 }
    );
  }
}
