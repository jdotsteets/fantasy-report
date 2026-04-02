// app/api/admin/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  createJob,
  appendEvent,
  setProgress,
  finishJobSuccess,
  failJob,
} from "@/lib/jobs";
import { runIngestOnce } from "@/lib/ingestRunner";
import { logIngest } from "@/lib/ingestLogs";
import type { ProbeMethod } from "@/lib/sources/types";

export const dynamic = "force-dynamic";

type Body = {
  sourceId?: number | string;
  limit?: number | string;
  debug?: boolean | string;
  sport?: string | null;
  jobId?: string | null;
  method?: ProbeMethod | string | null;
};

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !authHeader) {
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

function toInt(val: number | string | undefined): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) {
    return val;
  }

  if (typeof val === "string" && val.trim() !== "") {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toBool(val: boolean | string | undefined): boolean | undefined {
  if (typeof val === "boolean") {
    return val;
  }

  if (typeof val === "string") {
    const normalized = val.toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return undefined;
}

function toMethod(val: unknown): ProbeMethod | undefined {
  return val === "rss" || val === "scrape" || val === "adapter"
    ? val
    : undefined;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const sourceId = toInt(body.sourceId);
  if (!sourceId) {
    return NextResponse.json(
      { ok: false, error: "Missing sourceId" },
      { status: 400 }
    );
  }

  const limit = toInt(body.limit) ?? 50;
  const debug = toBool(body.debug) ?? false;
  const sport = typeof body.sport === "string" ? body.sport : null;
  const method = toMethod(body.method ?? undefined);
  const externalJobId = body.jobId ?? null;

  const job = await createJob(
    "ingest",
    { sourceId, limit, debug, sport, method, externalJobId },
    "admin"
  );

  const trackingJobId = externalJobId ?? String(job.id);

  try {
    await appendEvent(job.id, "info", "Ingest started", {
      sourceId,
      limit,
      debug,
      sport,
      method: method ?? null,
      jobId: trackingJobId,
    });

    await logIngest({
      sourceId,
      reason: "static_detected",
      detail: "ingest started",
      jobId: trackingJobId,
      level: "info",
      event: "start",
    });

    let processed = 0;
    let inserted = 0;
    let updated = 0;

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

      if (step.meta?.inserted !== undefined) {
        inserted = Number(step.meta.inserted) || 0;
      }

      if (step.meta?.updated !== undefined) {
        updated = Number(step.meta.updated) || 0;
      }

      await appendEvent(job.id, step.level ?? "info", step.message, {
        ...(step.meta ?? {}),
        jobId: trackingJobId,
      });
    }

    await logIngest({
      sourceId,
      reason: "static_detected",
      detail: "ingest finished",
      jobId: trackingJobId,
      level: "info",
      event: "finish",
    });

    await finishJobSuccess(job.id, "Ingest finished");

    return NextResponse.json({
      ok: true,
      job_id: job.id,
      jobId: trackingJobId,
      new: inserted,
      processed: inserted + updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    await appendEvent(job.id, "error", "Ingest failed", {
      error: message,
      jobId: trackingJobId,
    });

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
      {
        ok: false,
        job_id: job.id,
        jobId: trackingJobId,
        error: message,
      },
      { status: 500 }
    );
  }
}