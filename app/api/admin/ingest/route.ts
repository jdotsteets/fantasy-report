// app/api/admin/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ingestAllSources, type UpsertResult } from "@/lib/ingest";
import {
  getSourcesHealth,
  getSourceErrorDigests,
  type HealthSummary,
} from "@/lib/adminHealth";

const okKey = (req: NextRequest) => {
  const want = process.env.ADMIN_KEY ?? "";
  const got = req.headers.get("x-admin-key") ?? "";
  return Boolean(want && got && got === want);
};

export const runtime = "nodejs";         // ensure Node runtime (not edge)
export const dynamic = "force-dynamic";  // NEVER prerender this route
export const revalidate = 0;             // disable caching for the route


// ---- small helpers (no `any`) ---------------------------------------------

function toNumber(input: unknown, fallback: number): number {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && input.trim() !== "") {
    const n = Number(input);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toBool(input: unknown, fallback = false): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input === 1;
  if (typeof input === "string") {
    const v = input.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  }
  return fallback;
}

function safeBody(obj: unknown): Record<string, unknown> {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : {};
}

export async function POST(req: NextRequest) {
  if (!okKey(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = url.searchParams;

  // Try to parse JSON body, but keep it as unknown and narrow safely.
  let parsed: unknown = undefined;
  try {
    parsed = await req.json();
  } catch {
    // no body provided or invalid JSON; that's fine
  }
  const body = safeBody(parsed);

  const limit = toNumber(q.get("limit") ?? body.limit, 50);
  const windowHours = Math.max(1, toNumber(q.get("windowHours") ?? body.windowHours, 72));
  const includeHealth = toBool(q.get("includeHealth") ?? body.includeHealth, false);
  const includeErrors = toBool(q.get("includeErrors") ?? body.includeErrors, false);

  // If ingestAllSources supports a specific source, you could plumb it here:
  // const sourceId = toNumber(q.get("sourceId") ?? body.sourceId, NaN);
  // const res = await ingestAllSources(limit, Number.isFinite(sourceId) ? sourceId : undefined);

  const res: Record<number, UpsertResult & { error?: string }> = await ingestAllSources(limit);

  if (includeHealth) {
    const tallies: Record<number, { inserted: number; updated: number; skipped: number }> = {};
    for (const key of Object.keys(res)) {
      const id = Number(key);
      const v = res[id];
      tallies[id] = { inserted: v.inserted, updated: v.updated, skipped: v.skipped };
    }

    const summary: HealthSummary = await getSourcesHealth(windowHours, tallies);
    if (includeErrors) {
      summary.errors = await getSourceErrorDigests(windowHours);
    }
    return NextResponse.json({ ok: true, task: "ingest", res, summary });
  }

  return NextResponse.json({ ok: true, task: "ingest", res });
}
