// app/api/admin/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ingestAllSources, ingestSourceById, type UpsertResult } from "@/lib/ingest";
import {
  getSourcesHealth,
  getSourceErrorDigests,
  type HealthSummary,
  type IngestTalliesBySource,
} from "@/lib/adminHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function okKey(req: NextRequest): boolean {
  const want = process.env.ADMIN_KEY ?? "";
  const got = req.headers.get("x-admin-key") ?? "";
  return Boolean(want && got && got === want);
}

// small helpers
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

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    parsed = undefined;
  }
  const body = safeBody(parsed);

  const limit = toNumber(q.get("limit") ?? body.limit, 50);
  const windowHours = Math.max(1, toNumber(q.get("windowHours") ?? body.windowHours, 72));
  const includeHealth = toBool(q.get("includeHealth") ?? body.includeHealth, false);
  const includeErrors = toBool(q.get("includeErrors") ?? body.includeErrors, false);

  // Optional: run only one source
  const sourceIdRaw = q.get("sourceId") ?? body.sourceId;
  const sourceId = typeof sourceIdRaw === "string" ? Number(sourceIdRaw) : Number(sourceIdRaw);
  const hasSingle = Number.isFinite(sourceId);

  try {
    let resultsArray: Array<{ source_id: number; result: UpsertResult }>;

    if (hasSingle) {
      const singleResult = await ingestSourceById(Number(sourceId));
      resultsArray = [{ source_id: Number(sourceId), result: singleResult }];
    } else {
      const all = await ingestAllSources(limit);
      resultsArray = Array.isArray(all) ? all : [];
    }

    // Shape back into a record keyed by source_id
    const res: Record<number, UpsertResult & { error?: string }> = Object.fromEntries(
      resultsArray.map((x) => [x.source_id, x.result])
    );

    if (includeHealth) {
      // ✅ FIX: provide lastAt so this matches IngestTalliesBySource
      const tallies: IngestTalliesBySource = {};
      for (const [k, v] of Object.entries(res)) {
        const id = Number(k);
        tallies[id] = {
          inserted: v.inserted,
          updated: v.updated,
          skipped: v.skipped,
          lastAt: null, // if you later track per-source “lastAt” during this run, fill it here
        };
      }

      const summary: HealthSummary = await getSourcesHealth(windowHours, tallies);
      if (includeErrors) {
        summary.errors = await getSourceErrorDigests(windowHours);
      }
      return NextResponse.json({ ok: true, task: "ingest", res, summary });
    }

    return NextResponse.json({ ok: true, task: "ingest", res });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[/api/admin/ingest] error:", err);
    return NextResponse.json({ ok: false, error: "ingest_failed" }, { status: 500 });
  }
}
