import { NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";
import { getBriefByArticleId } from "@/lib/briefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRow = {
  id: number;
  article_id: number;
  hook: string;
  body: string;
  cta: string | null;
  article_url: string | null;
  platform: "x";
  status: "draft" | "approved" | "scheduled" | "published" | "failed";
};

/* ---------------- helpers: sanitize ---------------- */

function stripRawLinks(text: string): string {
  return (text ?? "").replace(/\bhttps?:\/\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingHook(hook: string, body: string): string {
  const h = (hook ?? "").trim();
  const b = (body ?? "").trim();
  if (!h || !b) return b;
  if (b.localeCompare(h, undefined, { sensitivity: "accent" }) === 0) return "";
  const re = new RegExp(`^${escapeRegex(h)}(?:[\\s\\-–—:|]+)?`, "i");
  return b.replace(re, "").trim();
}

function baseUrl(): string {
  const b = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.thefantasyreport.com";
  return b.replace(/\/+$/, "");
}

async function ensureBriefShortlink(article_id: number): Promise<string> {
  const brief = await getBriefByArticleId(article_id);
  if (!brief) {
    const gen = await generateBriefForArticle(article_id, true); // autopublish
    return `${baseUrl()}/b/${gen.created_brief_id}`;
  }
  return `${baseUrl()}/b/${brief.id}`;
}

/* ---------------- helpers: timeout + retry ---------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number, base = 1500, cap = 60_000): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 400);
  return exp + jitter;
}

function explainTwitterError(err: unknown): string {
  try {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e?.name === "string") parts.push(`name=${e.name}`);
    if (typeof e?.message === "string") parts.push(`message=${e.message}`);
    if (typeof e?.status === "number") parts.push(`status=${e.status}`);
    if (e?.errors) parts.push(`errors=${JSON.stringify(e.errors)}`);
    if (e?.data) parts.push(`data=${JSON.stringify(e.data)}`);
    const resp = (e as any)?.response;
    if (resp && typeof resp.status === "number") parts.push(`httpStatus=${resp.status}`);
    const responseBody =
      typeof (e as any)?.responseBody === "string"
        ? (e as any).responseBody
        : typeof (e as any)?.body === "string"
        ? (e as any).body
        : null;
    if (responseBody) parts.push(`body=${responseBody}`);
    return parts.length ? parts.join(" | ") : String(err);
  } catch {
    return String(err);
  }
}

async function createWithRetry(
  client: Client,
  text: string,
  attempts = 5,
  baseBackoff = 1500,
  maxBackoff = 60_000,
  perCallTimeoutMs = 8000
): Promise<{ id: string | null; detail?: string }> {
  let lastDetail = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      // per-call timeout so we never hang the route
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), perCallTimeoutMs);

      const res = await client.tweets.createTweet({ text }, { signal: ctrl.signal as AbortSignal });
      clearTimeout(timer);

      const id = res.data?.id ?? null;
      if (id) return { id };
      lastDetail = "No tweet id in response";
    } catch (e) {
      lastDetail = explainTwitterError(e);
      if (lastDetail.includes("429")) {
        await sleep(backoffMs(i, baseBackoff, maxBackoff));
        continue;
      }
    }
    await sleep(300);
  }
  return { id: null, detail: lastDetail };
}

/* ---------------- compose ---------------- */

function composeTweetText(row: DraftRow, short: string): string {
  const hook = (row.hook ?? "").trim();
  const body = stripLeadingHook(hook, stripRawLinks(row.body ?? ""));
  const parts: string[] = [hook];
  if (body) parts.push(body);
  if (row.cta) parts.push(row.cta);
  parts.push(short);

  let text = parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
  if (text.length > 270) text = text.slice(0, 267) + "…";
  return text;
}

/* ---------------- route ---------------- */

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const rows = await dbQueryRows<DraftRow>(
    `select d.id,
            d.article_id,
            d.hook,
            d.body,
            d.cta,
            q.article_url,
            d.platform,
            d.status
       from social_drafts d
       join v_social_queue q on q.id = d.id
      where d.id = $1
      limit 1`,
    [idNum]
  );
  if (rows.length === 0) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const row = rows[0];
  if (row.platform !== "x") return NextResponse.json({ error: "Only X supported here" }, { status: 400 });
  if (row.status === "published") return NextResponse.json({ ok: true, note: "Already published" });

  const bearer = await getFreshXBearer();
  if (!bearer) return NextResponse.json({ error: "X not connected" }, { status: 400 });

  // Ensure brief shortlink
  let short = "";
  try {
    short = await ensureBriefShortlink(row.article_id);
  } catch (e) {
    return NextResponse.json({ error: "Brief link failed", detail: String(e) }, { status: 502 });
  }

  const text = composeTweetText(row, short);

  try {
    const client = new Client(bearer);
    const sent = await createWithRetry(client, text, 5, 1500, 60_000, 8000);
    if (!sent.id) {
      await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
      return NextResponse.json(
        { error: "Tweet failed", detail: sent.detail ?? "Unknown error" },
        { status: 502 }
      );
    }

    await dbQuery(`update social_drafts set status='published', updated_at=now() where id=$1`, [row.id]);
    return NextResponse.json({ ok: true, tweetId: sent.id, shortlink: short });
  } catch (e) {
    await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
    return NextResponse.json({ error: "Tweet error", detail: String(e) }, { status: 502 });
  }
}
