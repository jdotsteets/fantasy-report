import { NextResponse } from "next/server";
import { fetchFreshTopics } from "@/app/src/inputs/topics";
import { renderDrafts } from "@/app/src/writing/renderDrafts";
import { dbQuery } from "@/lib/db";

// simple CT (America/Chicago) slots; adjust to taste
const SLOTS_LOCAL = ["08:15", "12:30", "20:45"];

function nextIsoToday(slotHHMM: string): string {
  const [hh, mm] = slotHHMM.split(":").map(Number);
  const now = new Date();
  const dt = new Date(now);
  dt.setHours(hh, mm, 0, 0);
  // if slot already passed, push to tomorrow
  if (dt.getTime() <= now.getTime()) dt.setDate(dt.getDate() + 1);
  return dt.toISOString();
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const topics = await fetchFreshTopics({ windowHours: 24, maxItems: 6 });
  if (topics.length === 0) return NextResponse.json({ ok: true, scheduled: 0, note: "no topics" });

  const drafts = await renderDrafts(topics, { platforms: ["x"], variantsPerTopic: 1 });

  // pick up to 3 and schedule into slots
  const pick = drafts.slice(0, Math.min(3, drafts.length));
  const rows = pick.map((d, i) => ({
    article_id: Number(d.topicRef),
    platform: "x" as const,
    status: "scheduled" as const,
    hook: d.hook,
    body: d.body,
    cta: d.cta ?? null,
    media_url: null,
    scheduled_for: nextIsoToday(SLOTS_LOCAL[i % SLOTS_LOCAL.length]),
  }));

  // bulk insert as scheduled
  const values = rows
    .map((_r, i) =>
      `($${i * 8 + 1},$${i * 8 + 2},$${i * 8 + 3},$${i * 8 + 4},$${i * 8 + 5},$${i * 8 + 6},$${i * 8 + 7},$${i * 8 + 8})`
    )
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

  return NextResponse.json({ ok: true, scheduled: rows.length, slots: SLOTS_LOCAL });
}
