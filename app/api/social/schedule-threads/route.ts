// app/api/social/schedule-threads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { POST as publish } from "@/app/api/social/publish-thread/[section]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map: Tue -> waiver-wire; Fri/Sat -> start-sit
function pickSectionByWeekday(weekday: number): "waiver-wire" | "start-sit" | null {
  // 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat
  if (weekday === 2) return "waiver-wire";
  if (weekday === 5 || weekday === 6) return "start-sit";
  return null;
}

export async function GET(req: NextRequest) {
  // Respect America/Chicago (server may be UTC). Vercel Cron will hit at your chosen time;
  // this logic just picks the section for the day.
  const now = new Date();
  const weekday = now.getUTCDay(); // if you want strict Central calc, pass a tz param or compute offset
  const section = pickSectionByWeekday(weekday);

  if (!section) {
    return NextResponse.json({ ok: true, skipped: true, reason: "No scheduled thread for today." });
  }

  // Build a faux request to our publish endpoint (POST, not dry)
  const base = new URL(req.url);
  base.pathname = `/api/social/publish-thread/${section}`;
  const publishReq = new NextRequest(base.toString(), { method: "POST" });

  // Delegate
  return publish(publishReq, { params: Promise.resolve({ section }) });
}
