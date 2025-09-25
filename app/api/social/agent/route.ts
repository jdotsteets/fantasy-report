// app/api/social/agent/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Example POST — replace with your actual logic
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const payload: unknown = await req.json(); // keep typed as unknown until validated
    // TODO: validate `payload` (e.g., zod) and do work
    return NextResponse.json({ ok: true, payload }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

// Optionally support GET so file is always a module even if POST is removed later
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, status: "ready" });
}