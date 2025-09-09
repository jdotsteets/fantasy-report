// app/api/admin/source-probe/commit/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { findExistingSourceByUrl, saveSourceWithMethod } from "@/lib/sources";
import type { CommitPayload, ProbeMethod } from "@/lib/sources/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Best-effort ingest kickoff (includes jobId for tracking) */
async function triggerIngestForSource(
  sourceId: number,
  method: ProbeMethod,
  jobId: string
): Promise<void> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    await fetch(`${base}/api/admin/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId, method, jobId }),
    });
  } catch {
    // best-effort: ignore network errors here
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as CommitPayload;

    // Prefer an explicit sourceId; else, if upsert=true, try to find a matching host.
    const existing =
      payload.sourceId != null
        ? { id: payload.sourceId }
        : payload.upsert
        ? await findExistingSourceByUrl(payload.url)
        : null;

    const isCreate = !existing?.id;

    // ---- Normalize updates --------------------------------------------------
    // - If client provided paywall, coerce to boolean.
    // - If creating and paywall is missing/undefined, default to false so INSERT never fails.
    const incoming = payload.updates ?? {};
    const normalized: typeof incoming & { paywall?: boolean } = { ...incoming };

    if ("paywall" in incoming) {
      normalized.paywall = !!(incoming as any).paywall;
    } else if (isCreate) {
      normalized.paywall = false;
    }
    if (payload.updates?.adapter_endpoint) {
  normalized.adapter_endpoint = payload.updates.adapter_endpoint;
}
    // ------------------------------------------------------------------------

    // Create or update the source and switch to the selected method.
    const sourceId = await saveSourceWithMethod({
      url: payload.url,
      method: payload.method,
      feedUrl: payload.feedUrl ?? null,
      selector: payload.selector ?? null,
      adapterKey: payload.adapterKey ?? undefined,
      nameHint: payload.nameHint ?? null, // friendly default on INSERT
      sourceId: existing?.id,
      updates: normalized,


    });

    // Start an ingest run and return its tracking id.
    const jobId = crypto.randomUUID();
    await triggerIngestForSource(sourceId, payload.method, jobId);

    return NextResponse.json({ ok: true, sourceId, jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
