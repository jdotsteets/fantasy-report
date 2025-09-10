import { NextRequest, NextResponse } from "next/server";
import { createJob, appendEvent, setProgress, finishJobSuccess, failJob } from "@/lib/jobs";
import { ingestAllAllowedSources } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  perSourceLimit?: number | string;
  debug?: boolean | string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toInt(val: number | string | undefined, fallback: number): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim() !== "") {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function toBool(val: boolean | string | undefined): boolean | undefined {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return undefined;
}

function parseBody(u: unknown): Body {
  if (!isRecord(u)) return {};
  const perSourceLimit = ((): number | string | undefined => {
    const v = u["perSourceLimit"];
    return typeof v === "number" || typeof v === "string" ? v : undefined;
  })();
  const debug = ((): boolean | string | undefined => {
    const v = u["debug"];
    return typeof v === "boolean" || typeof v === "string" ? v : undefined;
  })();
  return { perSourceLimit, debug };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

export async function POST(req: NextRequest) {
  // Parse body (tolerate empty/malformed)
  const raw = (await req.json().catch(() => (null))) as unknown;
  const body = parseBody(raw);

  const perSourceLimit = toInt(body.perSourceLimit, 50);
  const debug = toBool(body.debug) ?? false;

  // Create a job row first so the UI can start polling immediately
  const job = await createJob(
    "ingest",
    { scope: "allowed", perSourceLimit, debug },
    "admin"
  );

  try {
    await appendEvent(job.id, "info", "Allowed sources ingest started", {
      perSourceLimit,
      debug,
    });

    // Initialize overall progress (per-source progress handled inside ingest)
    try {
      await setProgress(job.id, 0);
    } catch {
      /* ignore */
    }

    // Run the ingest (emits per-source events and updates progress)
    await ingestAllAllowedSources({ jobId: job.id, perSourceLimit });

    await finishJobSuccess(job.id, "Allowed sources ingest finished");
    return NextResponse.json({ ok: true, job_id: job.id });
  } catch (err) {
    const message = errorMessage(err);
    await appendEvent(job.id, "error", "Allowed sources ingest failed", { error: message });
    await failJob(job.id, message);
    return NextResponse.json({ ok: false, job_id: job.id, error: message }, { status: 500 });
  }
}
