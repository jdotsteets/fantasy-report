// app/api/admin/source-probe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runProbe } from "@/lib/sources/index";
import type { ProbeRequest, ProbeResult } from "@/lib/sources/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ProbeRequest;
  const url = (body?.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }
  try {
    const result = await runProbe({ url, windowHours: body.windowHours });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
