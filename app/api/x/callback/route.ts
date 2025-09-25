// app/api/x/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // You’ll replace this with the token-exchange code we wrote earlier.
  // For now, prove the route exists:
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  return NextResponse.json({ ok: true, note: "callback reached", code, state });
}
