// app/api/briefs/generate/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, route: "generate-GET" });
}

export async function POST() {
  return NextResponse.json({ ok: true, route: "generate-POST" }, { status: 201 });
}