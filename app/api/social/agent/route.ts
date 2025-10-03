// app/api/social/agent/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { fetchFreshTopics } from "@/app/src/inputs/topics";
import { renderDrafts } from "@/app/src/writing/renderDrafts";
import { dbQuery, dbQueryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────────────── Config ───────────────────────── */

type Platform = "x";

const DEFAULT_PLATFORMS: Platform[] = ["x"];
const MAX_TOPICS = 8;
const VARIANTS_PER_TOPIC = 2;

// Prefer very recent inputs for timeliness
const TOPIC_WINDOW_HOURS = 3;

// Cross-batch dedupe window by article_id
const LOOKBACK_HOURS_DEDUPE = 24;

// Keep the queue small to avoid long backlogs
const INFLIGHT_CAP_PER_PLATFORM = 8 as const;
const INFLIGHT_STATUSES = ["draft", "approved", "scheduled"] as const;

// Auto-prune old in-flight drafts before creating new ones
const STALE_HOURS_DELETE = 24;

/* ───────────────────────── Types ───────────────────────── */

type TopicForFilter = {
  title: string;
  body?: string;
  summary?: string;
};

type DraftLike = {
  topicRef: string | number; // article_id
  hook: string;
  body: string;
  cta?: string | null;
  platform: Platform;
  link?: string | null; // for URL-level de-dupe
};

type DraftInsertRow = {
  article_id: number;
  platform: Platform;
  status: "scheduled";
  hook: string;
  body: string;
  cta: string | null;
  media_url: string | null;
  scheduled_for: string; // ISO
};

/* ──────────────────────── Helpers ──────────────────────── */

function toArticleId(d: DraftLike): number {
  const n = Number(d.topicRef);
  return Number.isFinite(n) ? n : NaN;
}

async function getRecentlyQueuedArticleIds(
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

/** schedule_for within the next 2–10 minutes */
function nextIsoWithin10Min(): string {
  const now = new Date();
  const jitterMinutes = 2 + Math.floor(Math.random() * 9); // 2..10
  const when = new Date(now.getTime() + jitterMinutes * 60_000);
  when.setSeconds(0, 0);
  return when.toISOString();
}

/** very lightweight NFL-only filter (exclude NCAA/college keywords) */
function isNFLOnly(title: string, body?: string): boolean {
  const text = `${title} ${body ?? ""}`.toLowerCase();
  // common CFB markers/programs/conferences
  if (
    /\b(ncaa|college|cfb|alabama|georgia|lsu|ohio state|clemson|notre dame|auburn|michigan|longhorns|texas|usc|ucla|fsu|florida state|sec|big ten|big12|big 12|pac-12|pac 12|acc|sun belt|mac)\b/i.test(
      text
    )
  ) {
    return false;
  }
  return true;
}

async function deleteStaleInflight(staleHours: number): Promise<number> {
  const res = await dbQuery(
    `
      delete from social_drafts
       where status in ('draft','approved','scheduled')
         and created_at < now() - interval '${staleHours} hours'
    `
  );
  // dbQuery may or may not return rowCount; we ignore return type here
  // Return 0 to keep TypeScript happy if rowCount is not exposed
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

async function getInflightCount(platforms: Platform[]): Promise<Map<Platform, number>> {
  const rows = await dbQueryRows<{ platform: Platform; cnt: number }>(
    `select platform::text as platform, count(*)::int as cnt
       from social_drafts
      where status = any($1::text[])
        and platform = any($2::text[])
      group by platform`,
    [INFLIGHT_STATUSES, platforms]
  );
  const m = new Map<Platform, number>();
  for (const p of platforms) m.set(p, 0);
  for (const r of rows) m.set(r.platform, r.cnt);
  return m;
}

function computeAllowances(
  inflight: Map<Platform, number>,
  cap: number
): Map<Platform, number> {
  const allow = new Map<Platform, number>();
  for (const [p, n] of inflight.entries()) {
    allow.set(p, Math.max(0, cap - n));
  }
  return allow;
}

/* ───────────────────────── Core ───────────────────────── */

async function runAgent(dry: boolean): Promise<{
  ok: true;
  drafted: number;
  dry: boolean;
  note?: string;
  pruned?: number;
}> {
  // 0) Prune stale in-flight rows so backlog never grows unbounded
  const pruned = dry ? 0 : await deleteStaleInflight(STALE_HOURS_DELETE);

  // 1) Pick topics, bias to freshness and NFL-only
  const rawTopics = await fetchFreshTopics({ windowHours: TOPIC_WINDOW_HOURS, maxItems: MAX_TOPICS });
  const topics = rawTopics.filter((t) => {
    const tf = t as unknown as TopicForFilter;
    return isNFLOnly(tf.title ?? "", tf.body ?? tf.summary ?? "");
  });

  if (topics.length === 0) {
    return { ok: true, drafted: 0, dry, note: "no NFL topics found", pruned };
  }

  // 2) Render variants for the target platforms
  const draftsAll = await renderDrafts(topics, {
    platforms: DEFAULT_PLATFORMS,
    variantsPerTopic: VARIANTS_PER_TOPIC,
  });

  // 2a) In-batch de-dupe by normalized link (prevents duplicates across UTM variants)
  const seenLinks = new Set<string>();
  const drafts = (draftsAll as DraftLike[]).filter((d) => {
    const norm = normalizeUrl(d.link ?? null) ?? String(toArticleId(d));
    if (seenLinks.has(norm)) return false;
    seenLinks.add(norm);
    return true;
  });

  if (drafts.length === 0) {
    return { ok: true, drafted: 0, dry, note: "no renderable NFL drafts", pruned };
  }

  // 3) Cross-batch de-dupe by article_id (lookback)
  const candidateIds = drafts.map((d) => toArticleId(d)).filter((n) => Number.isFinite(n));
  const recent = await getRecentlyQueuedArticleIds(candidateIds, LOOKBACK_HOURS_DEDUPE);

  const fresh = drafts.filter((d) => {
    const aid = toArticleId(d);
    return Number.isFinite(aid) && !recent.has(aid);
  });

  if (fresh.length === 0) {
    return { ok: true, drafted: 0, dry, note: "all topics recently queued", pruned };
  }

  // 3b) Throttle by platform to avoid big backlogs
  const inflight = await getInflightCount(DEFAULT_PLATFORMS);
  const allow = computeAllowances(inflight, INFLIGHT_CAP_PER_PLATFORM);

  const bucketed = new Map<Platform, DraftLike[]>();
  for (const p of DEFAULT_PLATFORMS) bucketed.set(p, []);

  for (const d of fresh) {
    const list = bucketed.get(d.platform)!;
    if (list.length < (allow.get(d.platform) ?? 0)) list.push(d);
  }

  const toQueue: DraftLike[] = Array.from(DEFAULT_PLATFORMS).flatMap((p) => bucketed.get(p)!);

  if (toQueue.length === 0) {
    return { ok: true, drafted: 0, dry, note: "queue full (in-flight cap)", pruned };
  }

  // 4) Build rows as SCHEDULED (auto-queue within ~10m)
  const rows: DraftInsertRow[] = toQueue.map((d) => ({
    article_id: toArticleId(d),
    platform: d.platform,
    status: "scheduled",
    hook: d.hook,
    body: d.body,
    cta: d.cta ?? null,
    media_url: null,
    scheduled_for: nextIsoWithin10Min(),
  }));

  if (dry) {
    return { ok: true, drafted: rows.length, dry, note: "dry-run (no insert)", pruned };
  }

  // 5) Bulk insert with UPSERT safety (requires the partial unique index)
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
     values ${values}
     on conflict on constraint u_social_drafts_article_platform_inflight do nothing`,
    params
  );

  return { ok: true, drafted: rows.length, dry, pruned };
}

/* ───────────────────── Route Handlers ──────────────────── */

export async function GET(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const result = await runAgent(dry);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  let dry = false;
  try {
    const body = (await req.json()) as { dry?: boolean };
    dry = body?.dry === true;
  } catch {
    // no body → dry=false
  }
  const result = await runAgent(dry);
  return NextResponse.json(result);
}
