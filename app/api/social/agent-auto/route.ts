// app/api/social/agent-auto/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchFreshTopics } from "@/app/src/inputs/topics";
import { renderDrafts } from "@/app/src/writing/renderDrafts";
import { dbQuery, dbQueryRows } from "@/lib/db";
import type { Topic } from "@/app/src/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── Config ── */
const CT_START_HOUR = 7;
const CT_END_HOUR = 22;
const DAILY_TARGET_POSTS = 9;
const MAX_SCHEDULED_PER_RUN = 3;
const RECENT_HOURS_DEDUPE = 24;
const TOPIC_WINDOW_HOURS = 6;

// NEW: default quota for advice per batch (can be overridden via ?minAdvice=)
const DEFAULT_MIN_ADVICE_PER_BATCH = 2 as const;

type Platform = "x";

/* ── Types ── */
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

type RunOk = {
  ok: true;
  dry: boolean;
  scheduled: number;
  deficit: number;
  scheduledTodayCT: number;
  note?: string;
};
type RunErr = {
  ok: false;
  error: string;
  detail?: string;
};
type RunResult = RunOk | RunErr;

type Quotas = {
  minAdvice: number;
};

/* ── Auth helper ── */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("cron_secret");
  return header === secret || query === secret;
}

/* ── Time helpers ── */
function nowInTZ(tz: string): Date {
  const now = new Date();
  const localInTz = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const diff = now.getTime() - localInTz.getTime();
  return new Date(now.getTime() - diff);
}
function ctNow(): Date {
  return nowInTZ("America/Chicago");
}
function isWithinCTWindow(d: Date): boolean {
  const h = d.getHours();
  return h >= CT_START_HOUR && h < CT_END_HOUR;
}
/** schedule_for within the next 2–10 minutes */
function nextIsoWithin10Min(): string {
  const now = new Date();
  const jitterMinutes = 2 + Math.floor(Math.random() * 9);
  const when = new Date(now.getTime() + jitterMinutes * 60_000);
  when.setSeconds(0, 0);
  return when.toISOString();
}

/* ── DB helpers ── */
async function getScheduledCountTodayCT(): Promise<number> {
  const rows = await dbQueryRows<{ n: string }>(
    `
      select count(*)::text as n
        from social_drafts
       where status = 'scheduled'
         and (scheduled_for at time zone 'America/Chicago')::date
             = (now() at time zone 'America/Chicago')::date
         and extract(hour from (scheduled_for at time zone 'America/Chicago'))
             between $1 and $2 - 1
    `,
    [CT_START_HOUR, CT_END_HOUR],
    "count scheduled today CT window"
  );
  return rows.length ? Number(rows[0].n) : 0;
}

async function recentlyQueuedArticleIds(
  candidateIds: number[],
  lookbackHours: number
): Promise<Set<number>> {
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

/* ── Advice helpers ── */

function isAdviceTopic(t: Topic): boolean {
  // Your topics.ts sets angle="actionable advice" for advice/tips/strategy/how-to
  return (t.angle ?? "").toLowerCase() === "actionable advice";
}

/** Interleave two lists, starting with A (advice) for better variety. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length) out.push(a[i++]);
    if (j < b.length) out.push(b[j++]);
  }
  return out;
}

/** Pick at least `minAdvice`, then fill remaining from others; interleave for variety. */
function pickTopicsWithAdviceQuota(
  topics: Topic[],
  desiredCount: number,
  minAdvice: number
): Topic[] {
  const advice = topics.filter(isAdviceTopic);
  const other = topics.filter((t) => !isAdviceTopic(t));

  const mustAdvice = Math.min(minAdvice, desiredCount, advice.length);
  const advicePick = advice.slice(0, mustAdvice);
  const remainingSlots = Math.max(0, desiredCount - advicePick.length);
  const otherPick = other.slice(0, remainingSlots);

  // If we still have slots (not enough advice/other), fill from whichever has more left.
  const shortfall = desiredCount - (advicePick.length + otherPick.length);
  if (shortfall > 0) {
    const moreAdvice = advice.slice(advicePick.length);
    const moreOther = other.slice(otherPick.length);
    const tail = [...moreAdvice, ...moreOther].slice(0, shortfall);
    // Interleave with current picks for variety
    const mixed = interleave(advicePick, otherPick);
    return [...mixed, ...tail];
  }

  return interleave(advicePick, otherPick);
}

/* ── Core run ── */
async function runSchedule(dry: boolean, quotas: Quotas): Promise<RunResult> {
  const ct = ctNow();
  if (!isWithinCTWindow(ct)) {
    return { ok: true, dry, scheduled: 0, deficit: 0, scheduledTodayCT: 0, note: "outside CT window" };
  }

  const scheduledTodayCT = await getScheduledCountTodayCT();
  const remaining = Math.max(DAILY_TARGET_POSTS - scheduledTodayCT, 0);
  if (remaining === 0) {
    return { ok: true, dry, scheduled: 0, deficit: 0, scheduledTodayCT, note: "daily cap reached" };
  }

  // Fetch fresh candidate topics (we’ll subselect to enforce the advice quota)
  const topics = await fetchFreshTopics({ windowHours: TOPIC_WINDOW_HOURS, maxItems: 32 });
  if (topics.length === 0) {
    return { ok: true, dry, scheduled: 0, deficit: remaining, scheduledTodayCT, note: "no topics" };
  }

  // Decide how many we want this run, then pick topics with advice quota
  const desiredThisRun = Math.min(remaining, MAX_SCHEDULED_PER_RUN, topics.length);
  const selectedTopics = pickTopicsWithAdviceQuota(topics, desiredThisRun, quotas.minAdvice);

  // Render just the selected topics
  const drafts = await renderDrafts(selectedTopics, { platforms: ["x"], variantsPerTopic: 1 });
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

  const toSchedule = Math.min(remaining, MAX_SCHEDULED_PER_RUN, fresh.length);

  const rows: DraftRow[] = fresh.slice(0, toSchedule).map((d) => ({
    article_id: Number(d.topicRef),
    platform: "x",
    status: "scheduled",
    hook: d.hook,
    body: d.body,
    cta: d.cta ?? null,
    media_url: null,
    scheduled_for: nextIsoWithin10Min(),
  }));

  if (dry) {
    return {
      ok: true,
      dry,
      scheduled: rows.length,
      deficit: remaining - rows.length,
      scheduledTodayCT,
      note: "dry-run (no insert)",
    };
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

  try {
    await dbQuery(
      `insert into social_drafts
         (article_id, platform, status, hook, body, cta, media_url, scheduled_for)
       values ${values}
       on conflict do nothing`,
      params
    );
  } catch (err) {
    return { ok: false, error: "insert failed", detail: String(err) };
  }

  return {
    ok: true,
    dry,
    scheduled: rows.length,
    deficit: remaining - rows.length,
    scheduledTodayCT,
  };
}

/* ── Tiny utils ── */
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

/* ── Route handlers ── */
export async function GET(req: NextRequest) {
  if (process.env.DISABLE_POSTERS === "1") {
    return NextResponse.json({ ok: false, error: "Posting disabled" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const minAdviceParam = Number(url.searchParams.get("minAdvice") ?? "");
  const minAdvice = Number.isFinite(minAdviceParam)
    ? Math.max(0, Math.min(MAX_SCHEDULED_PER_RUN, minAdviceParam))
    : DEFAULT_MIN_ADVICE_PER_BATCH;

  const dry = url.searchParams.get("dry") === "1";
  const result = await runSchedule(dry, { minAdvice });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(req: NextRequest) {
  if (process.env.DISABLE_POSTERS === "1") {
    return NextResponse.json({ ok: false, error: "Posting disabled" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const minAdviceParam = Number(url.searchParams.get("minAdvice") ?? "");
  const minAdvice = Number.isFinite(minAdviceParam)
    ? Math.max(0, Math.min(MAX_SCHEDULED_PER_RUN, minAdviceParam))
    : DEFAULT_MIN_ADVICE_PER_BATCH;

  let dry = false;
  try {
    const body = (await req.json()) as { dry?: boolean };
    dry = body?.dry === true;
  } catch {
    // no body -> dry=false
  }
  const result = await runSchedule(dry, { minAdvice });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
