// app/api/social/worker/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";
import { getBriefByArticleId } from "@/lib/briefs";
import { composeThreadLead } from "@/app/src/social/compose"; // ✅ unified compose

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DueRow = {
  id: number;
  article_id: number;
  hook: string;
  body: string;
  cta: string | null;
  article_url: string | null;
};

type Result = { processed: number; postedIds: number[]; skipped: number; dry?: boolean };

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("cron_secret");
  return header === secret || query === secret;
}

function baseUrl(): string {
  const b = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.thefantasyreport.com";
  return b.replace(/\/+$/, "");
}

/* ---------- helpers: timebox, brief, fetch due ---------- */

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

async function ensureBriefShortlink(article_id: number): Promise<string> {
  const brief = await getBriefByArticleId(article_id);
  if (!brief) {
    const gen = await generateBriefForArticle(article_id, true); // autopublish
    return `${baseUrl()}/b/${gen.created_brief_id}`;
  }
  return `${baseUrl()}/b/${brief.id}`;
}

async function fetchDue(limit = 10): Promise<DueRow[]> {
  return dbQueryRows<DueRow>(
    `select d.id, d.article_id, d.hook, d.body, d.cta, q.article_url
       from social_drafts d
       join v_social_queue q on q.id = d.id
      where d.platform='x'
        and d.status='scheduled'
        and d.scheduled_for is not null
        and d.scheduled_for <= now()
      order by q.published_at desc nulls last,
               d.scheduled_for asc nulls last,
               d.id desc
      limit $1`,
    [limit]
  );
}

/* ---------- X helpers: compose + rate-limit handling ---------- */

function composeTweetText(row: DueRow, short: string): string {
  return composeThreadLead({
    hook: row.hook,
    body: row.body,
    cta: row.cta,
    short,
    maxChars: 270,
  });
}

type MaybeHeaders = { get(name: string): string | null } | undefined;
type TwitterLikeError = {
  status?: number;
  response?: { status?: number; headers?: MaybeHeaders };
  message?: string;
  name?: string;
  body?: string;
  responseBody?: string;
};

function headerNum(h: MaybeHeaders, key: string): number | undefined {
  if (!h || typeof h.get !== "function") return undefined;
  const raw = h.get(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function isRateLimit(err: unknown): boolean {
  const e = err as TwitterLikeError;
  const st = e?.status ?? e?.response?.status;
  if (st === 429) return true;
  const msg = `${e?.name ?? ""} ${e?.message ?? ""} ${e?.body ?? e?.responseBody ?? ""}`;
  return msg.includes("429");
}

function resetSeconds(err: unknown): number | null {
  const e = err as TwitterLikeError;
  const reset = headerNum(e?.response?.headers, "x-rate-limit-reset");
  if (typeof reset === "number") {
    const deltaMs = reset * 1000 - Date.now();
    return Math.max(0, Math.round(deltaMs / 1000));
  }
  const ra = headerNum(e?.response?.headers, "retry-after");
  return typeof ra === "number" ? ra : null;
}

/* ---------- main run ---------- */

type Mode = "live" | "dry" | "fast";

/**
 * live: post to X.
 * dry:  build text + ensure brief; do NOT hit X.
 * fast: just list IDs (no briefs, no X) — instant.
 */
async function runOnce(mode: Mode): Promise<Result> {
  const started = Date.now();
  const due = await fetchDue(10);

  if (mode === "fast") {
    return { processed: due.length, postedIds: due.map((d) => d.id), skipped: 0, dry: true };
  }
  if (due.length === 0) return { processed: 0, postedIds: [], skipped: 0, dry: mode !== "live" };

  let client: Client | null = null;
  if (mode === "live") {
    const bearer = await withTimeout(getFreshXBearer(), 8000, "getFreshXBearer");
    if (!bearer) return { processed: 0, postedIds: [], skipped: 0 };
    client = new Client(bearer);
  }

  const postedIds: number[] = [];
  let skipped = 0;

  for (const row of due) {
    console.log("[worker] processing id", row.id, "mode", mode);

    // brief link
    let short = "";
    try {
      short = await withTimeout(
        ensureBriefShortlink(row.article_id),
        10_000,
        `ensureBrief:${row.article_id}`
      );
    } catch (err) {
      console.warn("[worker] brief failed", row.id, String(err));
      skipped += 1;
      await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
      continue;
    }

    const text = composeTweetText(row, short);

    if (mode !== "live") {
      postedIds.push(row.id);
      continue;
    }

    try {
      const res = await withTimeout(client!.tweets.createTweet({ text }), 8000, `tweet:${row.id}`);
      if (res.data?.id) {
        await dbQuery(`update social_drafts set status='published', updated_at=now() where id=$1`, [row.id]);
        postedIds.push(row.id);
        console.log("[worker] published", row.id);
      } else {
        skipped += 1;
        await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
        console.warn("[worker] no id in response", row.id);
      }
    } catch (err) {
      // If rate limited, re-schedule instead of failing the draft
      if (isRateLimit(err)) {
        const bump = Math.max(resetSeconds(err) ?? 600, 300); // wait at least 5–10m
        await dbQuery(
          `update social_drafts
             set status='scheduled',
                 scheduled_for = now() + ($1 || ' seconds')::interval,
                 updated_at = now()
           where id=$2`,
          [String(bump), row.id]
        );
        console.warn("[worker] rate-limited; rescheduled", row.id, "in", bump, "seconds");
      } else {
        await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
        console.warn("[worker] tweet failed", row.id, String(err));
      }
      skipped += 1;
    }
  }

  console.log(
    "[worker] done in",
    Date.now() - started,
    "ms",
    "processed",
    due.length,
    "postedIds",
    postedIds.length,
    "skipped",
    skipped
  );

  return { processed: due.length, postedIds, skipped, dry: mode !== "live" };
}

/* ---------- route handlers ---------- */

export async function GET(req: NextRequest) {
  // quick diag
  if (req.nextUrl.searchParams.get("diag") === "1") {
    const [{ count }] = await dbQueryRows<{ count: string }>(
      `select count(*)::text as count
         from social_drafts d
         join v_social_queue q on q.id = d.id
        where d.platform='x'
          and d.status='scheduled'
          and d.scheduled_for is not null
          and d.scheduled_for <= now()`
    );
    return NextResponse.json({
      ok: true,
      hasSecret: Boolean(process.env.CRON_SECRET),
      dueCount: Number(count ?? "0"),
      now: new Date().toISOString(),
    });
  }

  if (process.env.DISABLE_POSTERS === "1") {
    return NextResponse.json({ ok: false, error: "Posting disabled" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const mode: Mode = req.nextUrl.searchParams.get("dry") === "1" ? "dry" : "live";
  const result = await runOnce(mode);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  if (process.env.DISABLE_POSTERS === "1") {
    return NextResponse.json({ ok: false, error: "Posting disabled" }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const mode: Mode = req.nextUrl.searchParams.get("dry") === "1" ? "dry" : "live";
  const result = await runOnce(mode);
  return NextResponse.json(result);
}
