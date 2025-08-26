// app/api/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ingestAllSources, ingestSourceById } from "@/lib/ingest";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const sourceIdParam = searchParams.get("sourceId");
  const limitParam = searchParams.get("limit");

  const limit = limitParam ? Math.max(1, Math.min(Number(limitParam), 200)) : 50;

  try {
    if (sourceIdParam) {
      const sourceId = Number(sourceIdParam);
      if (!Number.isFinite(sourceId)) {
        return NextResponse.json({ error: "Invalid sourceId" }, { status: 400 });
      }
      const result = await ingestSourceById(sourceId, limit);
      return NextResponse.json({ sourceId, limit, result });
    }

    const results = await ingestAllSources(limit);
    return NextResponse.json({ limit, results });
  } catch (err) {
    // Never leak internals
    console.error("[/api/ingest] error:", err);
    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}