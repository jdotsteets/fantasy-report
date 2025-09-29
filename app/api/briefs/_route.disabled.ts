// app/api/briefs/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { BriefPayloadSchema } from "@/lib/zodBriefs";
import { createBrief } from "@/lib/briefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const bodyUnknown = await req.json();
    const parsed = BriefPayloadSchema.safeParse(bodyUnknown);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const brief = await createBrief(parsed.data);
    return NextResponse.json(brief, { status: 201 });
  } catch (err) {
    // TEMP: echo error so curl shows *why* it failed
    const msg =
      err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error";
    console.error("POST /api/briefs failed:", err);
    return NextResponse.json({ error: "server_error", message: msg }, { status: 500 });
  }
}
