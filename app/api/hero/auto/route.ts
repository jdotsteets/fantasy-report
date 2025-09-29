import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clearing manual hero makes /current fall back to auto immediately */
export async function POST(_req: NextRequest) {
  await dbQuery(`delete from site_hero where created_at < now() + interval '100 years'`); // simple “clear”
  return NextResponse.json({ ok: true });
}
