import { NextRequest, NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";
import { getBriefByArticleId } from "@/lib/briefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!secret) return true; // unlocked when no secret set
  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("cron_secret");
  return header === secret || query === secret;
}

function stripRawLinks(text: string): string {
  return text.replace(/\bhttps?:\/\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
}

function baseUrl(): string {
  const b = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.thefantasyreport.com";
  return b.replace(/\/+$/, "");
}

/* ---------- helpers: text compose & de-dupe ---------- */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove the hook from the start of the body if it's repeated there (case-insensitive). */
function stripLeadingHook(hook: string, body: string): string {
  const h = (hook ?? "").trim();
  const b = (body ?? "").trim();
  if (!h || !b) return b;
  if (b.localeCompare(h, undefined, { sensitivity: "accent" }) === 0) return "";
  const re = new RegExp(`^${escapeRegex(h)}(?:[\\s\\-–—:|]+)?`, "i");
  return b.replace(re, "").trim();
}

function composeTweetText(row: DueRow, short: string): string {
  const hook = (row.hook ?? "").trim();
  const body = stripLeadingHook(hook, stripRawLinks(row.body ?? ""));
  const parts: string[] = [hook];
  if (body) parts.push(body);
  if (row.cta) parts.push(row.cta);
  parts.push(short);

  let text = parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
  if (text.length > 270) text = `${text.slice(0, 267)}…`;
  return text;
}

/* ---------- helpers: timebox & logging ---------- */

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
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
    return { processed: due.length, postedIds: due.map(d => d.id), skipped: 0, dry: true };
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

    let short = "";
    try {
      short = await withTimeout(ensureBriefShortlink(row.article_id), 10000, `ensureBrief:${row.article_id}`);
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
      skipped += 1;
      await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
      console.warn("[worker] tweet failed", row.id, String(err));
    }
  }

  console.log("[worker] done in", Date.now() - started, "ms",
              "processed", due.length, "postedIds", postedIds.length, "skipped", skipped);

  return { processed: due.length, postedIds, skipped, dry: mode !== "live" };
}

export async function GET(req: NextRequest) {
  // Keep diag probe available even when disabled
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

  // Kill-switch: set DISABLE_POSTERS=1 in env to pause automation
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
  // Kill-switch: set DISABLE_POSTERS=1 in env to pause automation
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
