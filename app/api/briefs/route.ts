// app/api/briefs/route.ts  (POST create)
import { NextResponse } from "next/server";
import { BriefPayloadSchema } from "@/lib/zodBriefs";
import { createBrief } from "@/lib/briefs";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = BriefPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const b = await createBrief(parsed.data);
  return NextResponse.json(b, { status: 201 });
}
