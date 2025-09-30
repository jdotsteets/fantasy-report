// app/api/test-brief/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { testBriefDryRun } from "@/lib/agent/testHarness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }   // ← params is a Promise
) {
  const { id: idStr } = await ctx.params;     // ← await it
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const out = await testBriefDryRun({ article_id: id }); // object shape expected
    return NextResponse.json({ ok: true, data: out });
  } catch (e) {
    const msg = (e as Error).message ?? "Unknown error";
    if (/OpenAI HTTP 429/i.test(msg) || /rate[_ -]?limit/i.test(msg)) {
      return NextResponse.json(
        { ok: false, error: "Rate limit hit. Please retry shortly.", detail: msg },
        { status: 429 }
      );
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
