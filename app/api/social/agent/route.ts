import { NextRequest, NextResponse } from "next/server";
import { POST as publish } from "@/app/api/social/publish-thread/[section]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────────────── helpers ───────────────────────── */

type Section = "waiver-wire" | "start-sit";

/** Optional auth (same pattern as your worker). If CRON_SECRET is unset, route is open. */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("cron_secret");
  return header === secret || query === secret;
}

/** Tue -> waiver-wire; Fri/Sat -> start-sit */
function pickSectionByWeekday(weekday: number): Section | null {
  // 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat
  if (weekday === 2) return "waiver-wire";
  if (weekday === 5 || weekday === 6) return "start-sit";
  return null;
}

/** Get weekday (0–6) in an IANA time zone, default America/Chicago. */
function weekdayInTz(tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const short = fmt.format(new Date()); // e.g., "Tue"
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? new Date().getUTCDay();
}

/* ───────────────────────── route ───────────────────────── */

export async function GET(req: NextRequest) {
  // Kill-switch: set DISABLE_POSTERS=1 in env to pause automation
  if (process.env.DISABLE_POSTERS === "1") {
    return NextResponse.json({ ok: false, error: "Posting disabled" }, { status: 503 });
  }

  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);

  // Allow overriding section directly: ?section=waiver-wire|start-sit
  const forced = url.searchParams.get("section") as Section | null;
  const tz = url.searchParams.get("tz") || "America/Chicago";
  const weekday = weekdayInTz(tz);

  const section: Section | null = forced ?? pickSectionByWeekday(weekday);

  if (!section) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "No scheduled thread for today.",
      weekday,
      tz,
    });
  }

  // Build a POST to the publisher and forward useful params
  const forwardParams = new URLSearchParams();
  for (const key of ["limit", "days", "perProviderCap", "week", "dry"] as const) {
    const v = url.searchParams.get(key);
    if (v != null) forwardParams.set(key, v);
  }

  const base = new URL(req.url);
  base.pathname = `/api/social/publish-thread/${section}`;
  base.search = forwardParams.toString();

  const publishReq = new NextRequest(base.toString(), { method: "POST", headers: req.headers });

  // Delegate to the publisher route
  return publish(publishReq, { params: Promise.resolve({ section }) });
}
