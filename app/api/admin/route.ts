// app/api/admin/ingest/route.ts
import { NextResponse } from "next/server";
import { ingestAllSources, ingestSourceById } from "@/lib/ingest";

export const runtime = "nodejs";

function isAuthorized(headers: Headers): boolean {
  const key = headers.get("x-admin-key");
  const expected = process.env.ADMIN_KEY;
  return !!expected && key === expected;
}

export async function POST(req: Request) {
  if (!isAuthorized(req.headers)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    sourceId?: number;
    limit?: number;
  };

  try {
    if (typeof body.sourceId === "number") {
      const out = await ingestSourceById(body.sourceId, body.limit ?? 50);
      return NextResponse.json({ ok: true, mode: "single", sourceId: body.sourceId, result: out });
    }
    const out = await ingestAllSources(body.limit ?? 50);
    return NextResponse.json({ ok: true, mode: "all", result: out });
  } catch (e) {
    console.error("[/api/admin/ingest]", e);
    return NextResponse.json({ ok: false, error: "ingest_failed" }, { status: 500 });
  }
}
