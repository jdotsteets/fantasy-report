// app/api/social/agent-auto/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchFreshTopics } from "@/app/src/inputs/topics";
import { renderDrafts } from "@/app/src/writing/renderDrafts";
import { dbQuery, dbQueryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLOTS_LOCAL = ["08:15", "12:30", "20:45"] as const;
const MAX_RECENT_HOURS_DEDUPE = 48;
const MAX_SCHEDULED_PER_RUN = 3;

type DraftRow = {
  article_id: number;
  platform: "x";
  status: "scheduled";
  hook: string;
  body: string;
  cta: string | null;
  media_url: string | null;
  scheduled_for: string;
};

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no lock if env not set

  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("cron_secret");
  return header === secret || query === secret;
}

function clampIsoFuture(dt: Date): string {
  const now = new Date();
  if (dt.getTime() <= now.getTime()) dt.setDate(dt.getDate() + 1);
  dt.setSeconds(0, 0);
  return dt.toISOString();
}

function jitterMinutes(base: Date, maxAbsMinutes: number): Date {
  const delta =
    (Math.floor(Math.random() * (maxAbsMinutes * 2 + 1)) - maxAbsMinutes) * 60_000;
  return new Date(base.getTime() + delta);
}

function nextIsoTodayWithJitter(slotHHMM: string, jitterAbsMinutes = 30): string {
  const [hh, mm] = slotHHMM.split(":").map(Number);
  const now = new Date();
  const dt = new Date(now);
  dt.setHours(hh, mm, 0, 0);
  const j = jitterMinutes(dt, jitterAbsMinutes);
  return clampIsoFuture(j);
}

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

async function runSchedule(dry: boolean): Promise<{
  ok: true;
  scheduled: number;
  slots: readonly string[];
  jitter: string;
  picked?: number;
  fresh?: number;
  note?: string;
}> {
  const topics = await fetchFreshTopics({ windowHours: 24, maxItems: 12 });
  if (topics.length === 0) {
    return { ok: true, scheduled: 0, slots: SLOTS_LOCAL, jitter: "±30m", note: "no topics" };
  }

  const drafts = await renderDrafts(topics, { platforms: ["x"], variantsPerTopic: 1 });
  if (drafts.length === 0) {
    return { ok: true, scheduled: 0, slots: SLOTS_LOCAL, jitter: "±30m", note: "no drafts" };
  }

  // in-batch de-dupe (by article + normalized link)
  const uniqByArticle = new Map<number, typeof drafts[number]>();
  const seenLinks = new Set<string>();
  for (const d of drafts) {
    const aid = Number(d.topicRef);
    if (!Number.isFinite(aid)) continue;
    const norm = normalizeUrl(d.link);
    if (uniqByArticle.has(aid)) continue;
    if (norm && seenLinks.has(norm)) continue;
    uniqByArticle.set(aid, d);
    if (norm) seenLinks.add(norm);
  }
  const candidates = Array.from(uniqByArticle.values());

  // cross-batch de-dupe (lookback)
  const ids = candidates.map((d) => Number(d.topicRef)).filter((n) => Number.isFinite(n));
  const recent = await recentlyQueuedArticleIds(ids, MAX_RECENT_HOURS_DEDUPE);
  const fresh = candidates.filter((d) => !recent.has(Number(d.topicRef)));
  if (fresh.length === 0) {
    return { ok: true, scheduled: 0, slots: SLOTS_LOCAL, jitter: "±30m", note: "all links recently used" };
  }

  const pick = fresh.slice(0, Math.min(MAX_SCHEDULED_PER_RUN, fresh.length));
  const rows: DraftRow[] = pick.map((d, i) => ({
    article_id: Number(d.topicRef),
    platform: "x",
    status: "scheduled",
    hook: d.hook,
    body: d.body,
    cta: d.cta ?? null,
    media_url: null,
    scheduled_for: nextIsoTodayWithJitter(SLOTS_LOCAL[i % SLOTS_LOCAL.length], 30)
  }));

  if (dry) {
    return { ok: true, scheduled: rows.length, slots: SLOTS_LOCAL, jitter: "±30m", picked: pick.length, fresh: fresh.length, note: "dry-run (no insert)" };
  }

  const values = rows
    .map((_r, i) => {
      const j = i * 8;
      return `($${j + 1},$${j + 2},$${j + 3},$${j + 4},$${j + 5},$${j + 6},$${j + 7},$${j + 8})`;
    })
    .join(", ");
  const params = rows.flatMap((r) => [r.article_id, r.platform, r.status, r.hook, r.body, r.cta, r.media_url, r.scheduled_for]);

  await dbQuery(
    `insert into social_drafts
      (article_id, platform, status, hook, body, cta, media_url, scheduled_for)
     values ${values}`,
    params
  );

  return { ok: true, scheduled: rows.length, slots: SLOTS_LOCAL, jitter: "±30m", picked: pick.length, fresh: fresh.length };
}

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
  } catch {
    // no body -> dry=false
  }
  const result = await runSchedule(dry);
  return NextResponse.json(result);
}
