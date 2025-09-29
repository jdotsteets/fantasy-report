import { NextResponse } from "next/server";
import { fetchFreshTopics } from "@/app/src/inputs/topics";
import { renderDrafts } from "@/app/src/writing/renderDrafts";
import { dbQuery, dbQueryRows } from "@/lib/db";

// Local CT “nominal” slots. We'll add ±30 min jitter to each.
const SLOTS_LOCAL = ["08:15", "12:30", "20:45"] as const;
const MAX_RECENT_HOURS_DEDUPE = 48;
const MAX_SCHEDULED_PER_RUN = 3;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -- helpers ---------------------------------------------------------------

function clampIsoFuture(dt: Date): string {
  // if in the past, push to tomorrow same time
  const now = new Date();
  if (dt.getTime() <= now.getTime()) {
    dt.setDate(dt.getDate() + 1);
  }
  // snap to minute
  dt.setSeconds(0, 0);
  return dt.toISOString();
}

function jitterMinutes(base: Date, maxAbsMinutes: number): Date {
  // random integer in [-max, +max]
  const delta = (Math.floor(Math.random() * (maxAbsMinutes * 2 + 1)) - maxAbsMinutes) * 60_000;
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
    // strip tracking noise
    url.searchParams.delete("utm_source");
    url.searchParams.delete("utm_medium");
    url.searchParams.delete("utm_campaign");
    url.searchParams.delete("utm_term");
    url.searchParams.delete("utm_content");
    // remove protocol + www + trailing slash to improve de-dupe
    const host = url.hostname.replace(/^www\./i, "");
    const path = url.pathname.replace(/\/+$/, "");
    const q = url.search ? `?${url.searchParams.toString()}` : "";
    return `${host}${path}${q}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
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

// -- route ----------------------------------------------------------------

export async function POST() {
  // 1) Gather topics → drafts
  const topics = await fetchFreshTopics({ windowHours: 24, maxItems: 12 });
  if (topics.length === 0) {
    return NextResponse.json({ ok: true, scheduled: 0, slots: SLOTS_LOCAL, note: "no topics" });
  }

  const drafts = await renderDrafts(topics, { platforms: ["x"], variantsPerTopic: 1 });
  if (drafts.length === 0) {
    return NextResponse.json({ ok: true, scheduled: 0, slots: SLOTS_LOCAL, note: "no drafts" });
  }

  // 2) In-batch de-dupe: ensure we don't pick multiple of the same article/link
  //    Use BOTH article_id (topicRef) and normalized link string.
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

  // 3) Cross-batch de-dupe: skip anything queued in the last 48h
  const candidateIds = candidates.map((d) => Number(d.topicRef)).filter((n) => Number.isFinite(n));
  const recent = await recentlyQueuedArticleIds(candidateIds, MAX_RECENT_HOURS_DEDUPE);
  const fresh = candidates.filter((d) => !recent.has(Number(d.topicRef)));

  if (fresh.length === 0) {
    return NextResponse.json({ ok: true, scheduled: 0, slots: SLOTS_LOCAL, note: "all links recently used" });
  }

  // 4) Take up to N and schedule with ±30m jitter
  const pick = fresh.slice(0, Math.min(MAX_SCHEDULED_PER_RUN, fresh.length));
  const rows = pick.map((d, i) => ({
    article_id: Number(d.topicRef),
    platform: "x" as const,
    status: "scheduled" as const,
    hook: d.hook,
    body: d.body,
    cta: d.cta ?? null,
    media_url: null,
    scheduled_for: nextIsoTodayWithJitter(SLOTS_LOCAL[i % SLOTS_LOCAL.length], 30),
  }));

  // 5) Bulk insert
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

  return NextResponse.json({ ok: true, scheduled: rows.length, slots: SLOTS_LOCAL, jitter: "±30m" });
}

// Optional: quick probe
export async function GET() {
  return NextResponse.json({ ok: true, route: "agent-auto", slots: SLOTS_LOCAL, jitter: "±30m" });
}
