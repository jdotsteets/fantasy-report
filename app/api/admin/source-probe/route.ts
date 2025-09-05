// app/api/admin/source-probe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runProbe, findExistingSourceByUrl } from "@/lib/sources/index";
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
    // 1) run your existing probe
    const result = await runProbe({ url, windowHours: body.windowHours });

    // 2) detect an existing source by host (homepage/feed/sitemap match)
    const existingSource = await findExistingSourceByUrl(url);

    // 3) return the enriched payload (typed as ProbeResult)
    const enriched = { ...result, existingSource } satisfies ProbeResult;
    return NextResponse.json(enriched, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}