import { NextResponse, type NextRequest } from "next/server";
import { fetchFreshTopics } from "@/app/src/inputs/topics";
import { renderDrafts } from "@/app/src/writing/renderDrafts";
import { dbQuery, dbQueryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CONFIG
 */
const TIMEZONE = "America/Chicago";
const SLOTS_LOCAL: string[] = ["08:15", "12:30", "20:45"]; // HH:MM in local TZ
const MAX_PER_RUN = 3; // schedule at most N drafts per invocation

/**
 * Compute the next ISO timestamp for a given HH:MM occurring in TIMEZONE.
 * This is robust on serverless (UTC hosts) without external libs.
 */
function nextIsoInTimeZone(slotHHMM: string, timeZone: string): string {
  const [h, m] = slotHHMM.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    throw new Error(`Bad slot time: ${slotHHMM}`);
  }

  // Current time in the target time zone, as parts
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const curHour = Number(parts.hour);
  const curMin = Number(parts.minute);

  // Build a "local time in TZ" for today at slot HH:MM (as if it were UTC),
  // then correct by the TZ offset at that local wall time.
  const pretendUTC = Date.UTC(year, month - 1, day, h, m, 0, 0);

  // Get the offset (in minutes) for the target wall clock in that TZ:
  // We do this by formatting the "pretendUTC" instant in the TZ and measuring
  // the difference to the same instant in real UTC.
  const tzDateAtSlot = new Date(pretendUTC);
  const tzPartsAtSlot = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .formatToParts(tzDateAtSlot)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});

  // The displayed wall time in TZ for the pretendUTC instant:
  const wallH = Number(tzPartsAtSlot.hour);
  const wallM = Number(tzPartsAtSlot.minute);
  const wallY = Number(tzPartsAtSlot.year);
  const wallMo = Number(tzPartsAtSlot.month);
  const wallD = Number(tzPartsAtSlot.day);

  // Recreate the "true UTC instant" for that TZ wall time by assuming the TZ wall
  // time is (wallY, wallMo, wallD, h, m) and letting the engine compute the UTC epoch.
  const tzWallAsUTC = new Date(
    `${String(wallY).padStart(4, "0")}-${String(wallMo).padStart(2, "0")}-${String(wallD).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`
  );

  // If the slot for today has already passed in local TZ, add a day.
  const curLocalMinutes = curHour * 60 + curMin;
  const slotLocalMinutes = h * 60 + m;
  if (slotLocalMinutes <= curLocalMinutes) {
    tzWallAsUTC.setUTCDate(tzWallAsUTC.getUTCDate() + 1);
  }

  return tzWallAsUTC.toISOString();
}

/**
 * Filter out topics whose article_id has already produced a draft recently.
 * (Prevents duplicate spam across runs.)
 */
async function filterAlreadyQueued(articleIds: number[], lookbackHours = 36): Promise<Set<number>> {
  if (articleIds.length === 0) return new Set<number>();
  const rows = await dbQueryRows<{ article_id: number }>(
    `
    select distinct article_id
      from social_drafts
     where article_id = any($1::int[])
       and created_at > now() - interval '${lookbackHours} hours'
    `,
    [articleIds]
  );
  return new Set(rows.map((r) => r.article_id));
}

type DraftInsertRow = {
  article_id: number;
  platform: "x";
  status: "scheduled";
  hook: string;
  body: string;
  cta: string | null;
  media_url: string | null;
  scheduled_for: string; // ISO
};

async function runAgentAuto(dry: boolean): Promise<{ ok: true; scheduled: number; slots: string[]; dry: boolean; note?: string }> {
  // 1) Pull fresh topics and render drafts
  const topics = await fetchFreshTopics({ windowHours: 24, maxItems: 12 });
  if (topics.length === 0) {
    return { ok: true, scheduled: 0, slots: SLOTS_LOCAL, dry, note: "no topics" };
  }

  const drafts = await renderDrafts(topics, { platforms: ["x"], variantsPerTopic: 1 });
  if (drafts.length === 0) {
    return { ok: true, scheduled: 0, slots: SLOTS_LOCAL, dry, note: "no renderable drafts" };
  }

  // 2) Avoid duplicates (same article recently queued)
  const allArticleIds = drafts
    .map((d) => Number(d.topicRef))
    .filter((n) => Number.isFinite(n));
  const dupeSet = await filterAlreadyQueued(allArticleIds, 36);

  const fresh = drafts.filter((d) => {
    const aid = Number(d.topicRef);
    return Number.isFinite(aid) && !dupeSet.has(aid);
  });

  if (fresh.length === 0) {
    return { ok: true, scheduled: 0, slots: SLOTS_LOCAL, dry, note: "all topics recently queued" };
  }

  // 3) Pick up to MAX_PER_RUN, assign slots cyclically in CT
  const pick = fresh.slice(0, Math.min(MAX_PER_RUN, fresh.length));
  const rows: DraftInsertRow[] = pick.map((d, i) => ({
    article_id: Number(d.topicRef),
    platform: "x",
    status: "scheduled",
    hook: d.hook,
    body: d.body,
    cta: d.cta ?? null,
    media_url: null,
    scheduled_for: nextIsoInTimeZone(SLOTS_LOCAL[i % SLOTS_LOCAL.length], TIMEZONE),
  }));

  if (dry) {
    return { ok: true, scheduled: rows.length, slots: SLOTS_LOCAL, dry, note: "dry-run (no insert)" };
  }

  // 4) Bulk insert
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

  return { ok: true, scheduled: rows.length, slots: SLOTS_LOCAL, dry };
}

/**
 * GET (for Vercel Cron) and POST both supported.
 * Add ?dry=1 to GET for a no-op test.
 */
export async function GET(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const result = await runAgentAuto(dry);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  let dry = false;
  try {
    const body = (await req.json()) as { dry?: unknown };
    dry = body?.dry === true;
  } catch {
    // no body → dry=false
  }
  const result = await runAgentAuto(dry);
  return NextResponse.json(result);
}
