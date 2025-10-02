// app/api/social/agent-auto/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchFreshTopics } from "@/app/src/inputs/topics";
import { renderDrafts } from "@/app/src/writing/renderDrafts";
import { dbQuery, dbQueryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Window + throughput targets (Central Time)
const CT_START_HOUR = 7;   // 7:00 AM
const CT_END_HOUR = 22;    // 10:00 PM
const DAILY_TARGET_POSTS = 9;

// cadence per invocation
const MAX_SCHEDULED_PER_RUN = 2;        // schedule up to 2 each run (kept small to avoid bursts)
const RECENT_HOURS_DEDUPE = 48;

// "x" only for now
type Platform = "x";

type DraftRow = {
  article_id: number;
  platform: Platform;
  status: "scheduled";
  hook: string;
  body: string;
  cta: string | null;
  media_url: string | null;
  scheduled_for: string; // ISO
};

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unlocked in dev
  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("cron_secret");
  return header === secret || query === secret;
}

/* ───────────────── Time helpers (Central) ───────────────── */

function nowUTC(): Date { return new Date(); }

function nowInTZ(tz: string): Date {
  // Convert "now" to a Date object that carries the wall-clock time in `tz`
  // (offset-safe without external libs)
  const now = new Date();
  const parts = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  // `parts` has wall-clock in tz; to convert back to UTC timestamp, shift by diff
  const diff = now.getTime() - parts.getTime();
  return new Date(now.getTime() - diff);
}

function ctNow(): Date { return nowInTZ("America/Chicago"); }

function isWithinCTWindow(d: Date): boolean {
  const h = d.getHours();
  return h >= CT_START_HOUR && h < CT_END_HOUR;
}

function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

/** schedule_for within the next 5–25 minutes (always <= 30 mins) */
function nextIsoWithin30Min(): string {
  const base = nowUTC();
  const jitter = 5 + Math.floor(Math.random() * 21); // 5..25
  const when = addMinutes(base, jitter);
  when.setSeconds(0, 0);
  return when.toISOString();
}

/* ───────────────── DB helpers ───────────────── */

async function getScheduledCountTodayCT(): Promise<number> {
  // Count scheduled posts for "today in CT" within the 7–22 window
  const rows = await dbQueryRows<{ n: string }>(
    `
    select count(*)::text as n
      from social_drafts
     where status = 'scheduled'
       and (scheduled_for at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date
       and extract(hour from (scheduled_for at time zone 'America/Chicago')) between $1 and $2 - 1
    `,
    [CT_START_HOUR, CT_END_HOUR],
    "count scheduled today CT window"
  );
  return rows.length ? Number(rows[0].n) : 0;
}

async function recentlyQueuedArticleIds(candidateIds: number[], lookbackHours: number): Promise<Set<number>> {
  if (candidateIds.length === 0) return new Set<number>();
  const rows = await dbQueryRows<{ article_id: number }>(
    `
      select distinct article_id
        from social_drafts
       where article_id = any($1::int[])
         and created_at > now() - interval '${lookbackHours} hours'
    `,
    [candidateIds]
  );
  return new Set(rows.map((r) => r.article_id));
}

/* ───────────────── core run ───────────────── */

async function runSchedule(dry: boolean): Promise<{
  ok: true;
  dry: boolean;
  scheduled: number;
  deficit: number;
  scheduledTodayCT: number;
  note?: string;
}> {
  // Respect Central window
  const ct = ctNow();
  if (!isWithinCTWindow(ct)) {
    return { ok: true, dry, scheduled: 0, deficit: 0, scheduledTodayCT: 0, note: "outside CT window" };
  }

  // Current throughput state
  const scheduledTodayCT = await getScheduledCountTodayCT();
  const remaining = Math.max(DAILY_TARGET_POSTS - scheduledTodayCT, 0);
  if (remaining === 0) {
    return { ok: true, dry, scheduled: 0, deficit: 0, scheduledTodayCT, note: "daily cap reached" };
  }

  // Source topics/drafts
  const topics = await fetchFreshTopics({ windowHours: 24, maxItems: 16 });
  if (topics.length === 0) {
    return { ok: true, dry, scheduled: 0, deficit: remaining, scheduledTodayCT, note: "no topics" };
  }

  const drafts = await renderDrafts(topics, { platforms: ["x"], variantsPerTopic: 1 });
  if (drafts.length === 0) {
    return { ok: true, dry, scheduled: 0, deficit: remaining, scheduledTodayCT, note: "no drafts" };
  }

  // In-batch de-dupe by article id + normalized link
  const seenLinks = new Set<string>();
  const uniq: typeof drafts = [];
  for (const d of drafts) {
    const aid = Number(d.topicRef);
    if (!Number.isFinite(aid)) continue;
    const norm = normalizeUrl(d.link);
    if (norm && seenLinks.has(norm)) continue;
    seenLinks.add(norm ?? String(aid));
    uniq.push(d);
  }

  // Cross-batch de-dupe lookback
  const ids = uniq.map((d) => Number(d.topicRef)).filter((n) => Number.isFinite(n));
  const recent = await recentlyQueuedArticleIds(ids, RECENT_HOURS_DEDUPE);
  const fresh = uniq.filter((d) => !recent.has(Number(d.topicRef)));

  if (fresh.length === 0) {
    return { ok: true, dry, scheduled: 0, deficit: remaining, scheduledTodayCT, note: "all links recently used" };
  }

  // How many to schedule this run
  const toSchedule = Math.min(remaining, MAX_SCHEDULED_PER_RUN, fresh.length);

  const rows: DraftRow[] = fresh.slice(0, toSchedule).map((d) => ({
    article_id: Number(d.topicRef),
    platform: "x",
    status: "scheduled",
    hook: d.hook,
    body: d.body,
    cta: d.cta ?? null,
    media_url: null,
    // ⬇️ within 30 minutes from now for timeliness
    scheduled_for: nextIsoWithin30Min(),
  }));

  if (dry) {
    return { ok: true, dry, scheduled: rows.length, deficit: remaining - rows.length, scheduledTodayCT, note: "dry-run (no insert)" };
  }

  const values = rows
    .map((_r, i) => {
      const j = i * 8;
      return `($${j + 1},$${j + 2},$${j + 3},$${j + 4},$${j + 5},$${j + 6},$${j + 7},$${j + 8})`;
    })
    .join(", ");

  const params = rows.flatMap((r) => [
    r.article_id,
    r.platform,
    r.status,
    r.hook,
    r.body,
    r.cta,
    r.media_url,
    r.scheduled_for,
  ]);

  await dbQuery(
    `insert into social_drafts
      (article_id, platform, status, hook, body, cta, media_url, scheduled_for)
     values ${values}`,
    params
  );

  return { ok: true, dry, scheduled: rows.length, deficit: remaining - rows.length, scheduledTodayCT };
}

/* ───────────────── tiny utils ───────────────── */

function normalizeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    url.searchParams.delete("utm_source");
    url.searchParams.delete("utm_medium");
    url.searchParams.delete("utm_campaign");
    url.searchParams.delete("utm_term");
    url.searchParams.delete("utm_content");
    const host = url.hostname.replace(/^www\./i, "");
    const path = url.pathname.replace(/\/+$/, "");
    const q = url.search ? `?${url.searchParams.toString()}` : "";
    return `${host}${path}${q}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

/* ───────────────── route handlers ───────────────── */

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const result = await runSchedule(dry);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let dry = false;
  try {
    const body = (await req.json()) as { dry?: boolean };
    dry = body?.dry === true;
  } catch { /* no body -> dry=false */ }
  const result = await runSchedule(dry);
  return NextResponse.json(result);
}
