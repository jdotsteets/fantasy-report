// app/api/admin/source-probe/commit/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { findExistingSourceByUrl, saveSourceWithMethod } from "@/lib/sources";
import type { CommitPayload, ProbeMethod } from "@/lib/sources/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Kick off an ingest run (best-effort) */
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
    // best-effort; don't throw
  }
}

/** Normalize & enforce per-method field rules */
function normalizeUpdatesForMethod(
  method: ProbeMethod,
  payload: CommitPayload,
  isCreate: boolean
): Record<string, unknown> {
  // start from incoming updates (could be empty)
  const base = { ...(payload.updates ?? {}) } as Record<string, unknown>;

  // default homepage_url if not provided
  if (!base.homepage_url && payload.url) {
    base.homepage_url = payload.url;
  }

  // default allowed=true on create (non-destructive on update)
  if (isCreate && typeof base.allowed === "undefined") {
    base.allowed = true;
  }

  // coerce paywall to boolean when provided; default false on create
  if (Object.prototype.hasOwnProperty.call(base, "paywall")) {
    base.paywall = Boolean(base.paywall);
  } else if (isCreate) {
    base.paywall = false;
  }

  // Keep adapter_endpoint if caller sent it (pass-through)
  if (payload.updates?.adapter_endpoint) {
    base.adapter_endpoint = payload.updates.adapter_endpoint;
  }

  // Per-method field mapping & clearing
  if (method === "rss") {
    // Set rss_url from feedUrl; clear adapter/scrape
    base.rss_url = payload.feedUrl ?? null;
    base.adapter = null;
    base.adapter_config = null;
    base.scrape_selector = null;
    // leave sitemap_url as-is (unused by RSS)
  }

  if (method === "scrape") {
    // Set scrape_selector from selector; clear rss/adapter
    base.scrape_selector = payload.selector ?? null;
    base.rss_url = null;
    base.adapter = null;
    base.adapter_config = null;
    // sitemap_url irrelevant for scrape
  }

if (method === "adapter") {
  base.adapter = payload.adapterKey ?? null;
  base.rss_url = null;
  base.scrape_selector = null;

  if (typeof base.adapter_config === "undefined" || base.adapter_config === null) {
    base.adapter_config = {};
  }

  // ✅ Prefer an explicit sitemap/page from the caller, else fall back to the original URL,
  // and only as a last resort default to the domain sitemap.xml.
  if (!base.sitemap_url) {
    const explicit = payload.updates?.sitemap_url ?? null;
    if (explicit) {
      base.sitemap_url = explicit;
    } else if (payload.url) {
      base.sitemap_url = payload.url; // keep the page-level URL that produced the 40 items
    } else {
      try {
        const u = new URL(payload.url ?? "");
        base.sitemap_url = `${u.origin}/sitemap.xml`;
      } catch {
        base.sitemap_url = null;
      }
    }
  }
}
  // NOTE: We deliberately do NOT force sport here.
  // If you want to set sport (e.g., 'nfl') do it via payload.updates.sport
  // or add a domain-based default in your backend.

  return base;
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as CommitPayload;

    if (!payload.method) {
      return NextResponse.json({ error: "Missing method" }, { status: 400 });
    }
    if (!payload.url) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    // Find/create target source
    const existing =
      payload.sourceId != null
        ? { id: payload.sourceId }
        : payload.upsert
        ? await findExistingSourceByUrl(payload.url)
        : null;

    const isCreate = !existing?.id;

    // Build full updates object honoring method semantics
    const updates = normalizeUpdatesForMethod(payload.method, payload, isCreate);

    // Persist source (create/update) with method-specific fields mapped
    const sourceId = await saveSourceWithMethod({
      url: payload.url,
      method: payload.method,
      feedUrl: payload.feedUrl ?? null,
      selector: payload.selector ?? null,
      adapterKey: payload.adapterKey ?? undefined,
      nameHint: payload.nameHint ?? null,
      sourceId: existing?.id,
      updates,
      upsert: payload.upsert ?? true,
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
