// app/api/social/publish-now/[id]/route.ts
import { NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";
import { getBriefByArticleId } from "@/lib/briefs";
/* ---------------- helpers: sanitize/compose ---------------- */
import {
  composeThreadLead,
  stripRawLinks,
  stripLeadingHook,
} from "@/app/src/social/compose"; // ⬅️ add this import up top


export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ---------------- types ---------------- */

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

type CreateTweetResult = {
  id: string | null;
  detail?: string;
  rateLimited?: boolean;
  resetAt?: number; // epoch seconds
};

type MaybeHeaders = { get(name: string): string | null } | undefined;
type TwitterLikeError = {
  name?: string;
  message?: string;
  status?: number;
  errors?: unknown;
  data?: unknown;
  response?: { status?: number; headers?: MaybeHeaders };
  responseBody?: string;
  body?: string;
};

/* ---------------- helpers: sanitize/compose ---------------- */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/** Compose the tweet text safely with unified normalization & stripping. */
function composeTweetText(row: DraftRow, short: string): string {
  // Uses the shared composeThreadLead helper (handles ellipses, em-dashes, etc.)
  return composeThreadLead({
    hook: row.hook,
    body: row.body,
    cta: row.cta,
    short,
    maxChars: 270,
  });
}


/* ---------------- timeouts & error helpers ---------------- */

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function headerNum(h: MaybeHeaders, key: string): number | undefined {
  if (!h || typeof h.get !== "function") return undefined;
  const raw = h.get(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function readResetAtFromError(err: unknown): number | undefined {
  const e = err as TwitterLikeError;
  return headerNum(e?.response?.headers, "x-rate-limit-reset");
}

function explainTwitterError(err: unknown): string {
  const e = err as TwitterLikeError;
  const parts: string[] = [];

  if (e?.name) parts.push(`name=${e.name}`);
  if (e?.message) parts.push(`message=${e.message}`);
  if (typeof e?.status === "number") parts.push(`status=${e.status}`);

  const resp = e?.response;
  if (resp?.status) parts.push(`httpStatus=${resp.status}`);

  const h = resp?.headers;
  const lim = headerNum(h, "x-rate-limit-limit");
  const rem = headerNum(h, "x-rate-limit-remaining");
  const rst = headerNum(h, "x-rate-limit-reset");
  if (typeof lim === "number") parts.push(`x-limit=${lim}`);
  if (typeof rem === "number") parts.push(`x-remaining=${rem}`);
  if (typeof rst === "number") parts.push(`x-reset=${rst}`);

  const body =
    typeof e?.responseBody === "string"
      ? e.responseBody
      : typeof e?.body === "string"
      ? e.body
      : undefined;
  if (body) parts.push(`body=${body}`);

  if (e?.errors) parts.push(`errors=${JSON.stringify(e.errors)}`);
  if (e?.data) parts.push(`data=${JSON.stringify(e.data)}`);

  return parts.length ? parts.join(" | ") : String(err);
}

/* ---------------- single-attempt tweet ---------------- */

async function createOnce(
  client: Client,
  text: string,
  perCallTimeoutMs = 8000
): Promise<CreateTweetResult> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), perCallTimeoutMs);
    const res = await client.tweets.createTweet({ text }, { signal: ctrl.signal as AbortSignal });
    clearTimeout(timer);
    const id = res.data?.id ?? null;
    return id ? { id } : { id: null, detail: "No tweet id in response" };
  } catch (err) {
    const detail = explainTwitterError(err);
    const resetAt = readResetAtFromError(err);
    const rateLimited = detail.includes("429");
    return { id: null, detail, rateLimited, resetAt };
  }
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

  // Global serialize: prevent overlapping publishes with same token
  const lockKey = 90211; // arbitrary global key
  const got = await dbQueryRows<{ got: boolean }>(
    "select pg_try_advisory_lock($1) as got",
    [lockKey]
  );
  if (!got[0]?.got) {
    return NextResponse.json(
      { error: "Another publish in progress. Try again in ~60s." },
      { status: 429 }
    );
  }

  try {
    const rows = await dbQueryRows<DraftRow>(
      `select d.id, d.article_id, d.hook, d.body, d.cta,
              q.article_url, d.platform, d.status
         from social_drafts d
         join v_social_queue q on q.id = d.id
        where d.id = $1
        limit 1`,
      [idNum]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const row = rows[0];
    if (row.platform !== "x") {
      return NextResponse.json({ error: "Only X supported here" }, { status: 400 });
    }
    if (row.status === "published") {
      return NextResponse.json({ ok: true, note: "Already published" });
    }

    const bearer = await getFreshXBearer();
    if (!bearer) {
      return NextResponse.json({ error: "X not connected" }, { status: 400 });
    }

    // Ensure brief shortlink (timeboxed, with safe fallback)
    let short = "";
    try {
      short = await withTimeout(
        ensureBriefShortlink(row.article_id),
        8000,
        `brief:${row.article_id}`
      );
    } catch (e) {
      // Fallback to article URL or site root; do not fail the request
      short = row.article_url ?? baseUrl();
      // eslint-disable-next-line no-console
      console.warn("[publish-now] brief failed, using fallback URL", {
        id: row.id,
        article_id: row.article_id,
        detail: String(e),
      });
    }

    const text = composeTweetText(row, short);
    const client = new Client(bearer);

    // Single attempt (no local re-tries)
    const sent = await createOnce(client, text, 8000);

    if (!sent.id) {
      if (sent.rateLimited) {
        // Do NOT poison the draft on 429; let user retry after reset
        await dbQuery(`update social_drafts set status='approved', updated_at=now() where id=$1`, [row.id]);
        return NextResponse.json(
          {
            error: "Rate limited by X",
            detail: sent.detail ?? "429",
            resetAt: sent.resetAt ?? null
          },
          { status: 429 }
        );
      }
      await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
      return NextResponse.json(
        { error: "Tweet failed", detail: sent.detail ?? "Unknown error" },
        { status: 502 }
      );
    }

    await dbQuery(`update social_drafts set status='published', updated_at=now() where id=$1`, [row.id]);
    return NextResponse.json({ ok: true, tweetId: sent.id, shortlink: short });

  } finally {
    // Always release the advisory lock
    await dbQuery("select pg_advisory_unlock($1)", [lockKey]).catch(() => {});
  }
}
