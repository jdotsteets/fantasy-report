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

export async function POST(req: NextRequest) {
  // Parse body (tolerate empty/malformed)
  const body = (await req.json().catch(() => ({}))) as Body;

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

    // If you want a coarse overall progress bar, we’ll set the total to the count
    // inside ingestAllAllowedSources when it logs "Starting ingest for allowed sources".
    // Here we just initialize to 0.
    try { await setProgress(job.id, 0); } catch { /* ignore */ }

    // Run the ingest (this will emit per-source events and update progress)
    await ingestAllAllowedSources({ jobId: job.id, perSourceLimit });

    await finishJobSuccess(job.id, "Allowed sources ingest finished");
    return NextResponse.json({ ok: true, job_id: job.id });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await appendEvent(job.id, "error", "Allowed sources ingest failed", { error: message });
    await failJob(job.id, message);
    return NextResponse.json({ ok: false, job_id: job.id, error: message }, { status: 500 });
  }
}
