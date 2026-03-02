// lib/social/x.ts
import { Client } from "twitter-api-sdk";
import { getFreshXBearer } from "@/app/src/social/xAuth";

export type XPost = { text: string };
type PostResult = { ids: string[]; dry: boolean };

export type PostThreadOptions = {
  dry?: boolean;
  paceMs?: number;
  attempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  perCallTimeoutMs?: number; // NEW: default 8000
};

/* ───────────────────── helpers ───────────────────── */

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

function headerNum(h: MaybeHeaders, key: string): number | undefined {
  if (!h || typeof h.get !== "function") return undefined;
  const raw = h.get(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type CreateArgs = { text: string; reply?: { in_reply_to_tweet_id: string } };

function backoffMs(attempt: number, base = 1500, cap = 60_000): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 400);
  return exp + jitter;
}

async function createWithRetry(
  client: Client,
  args: CreateArgs,
  attempts: number,
  baseMs: number,
  capMs: number,
  perCallTimeoutMs = 8000
): Promise<{ id: string | null; detail?: string }> {
  let lastDetail = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), perCallTimeoutMs);
      const res = await client.tweets.createTweet(args, { signal: ctrl.signal as AbortSignal });
      clearTimeout(timer);

      const id = res.data?.id ?? null;
      if (id) return { id };
      lastDetail = "No tweet id in response";
    } catch (e) {
      lastDetail = explainTwitterError(e);
      if (lastDetail.includes("429")) {
        await sleep(backoffMs(i, baseMs, capMs));
        continue;
      }
    }
    await sleep(300);
  }
  return { id: null, detail: lastDetail };
}

/* ───────────────────── posting API (unchanged signatures) ───────────────────── */

export async function postRoot(
  post: XPost,
  opts?: PostThreadOptions
): Promise<PostResult> {
  const o = {
    dry: Boolean(opts?.dry),
    attempts: Math.max(1, opts?.attempts ?? 5),
    baseBackoffMs: Math.max(200, opts?.baseBackoffMs ?? 1500),
    maxBackoffMs: Math.max(1000, opts?.maxBackoffMs ?? 60_000),
    perCallTimeoutMs: Math.max(1000, opts?.perCallTimeoutMs ?? 8000),
  };

  if (o.dry) return { ids: [], dry: true };
  const bearer = await getFreshXBearer();
  if (!bearer) throw new Error("No OAuth2 bearer. Run /api/x/connect (tweet.write scope).");
  const client = new Client(bearer);

  const r = await createWithRetry(client, { text: post.text }, o.attempts, o.baseBackoffMs, o.maxBackoffMs, o.perCallTimeoutMs);
  if (!r.id) throw new Error(r.detail || "Failed to create root tweet");
  return { ids: [r.id], dry: false };
}

export async function postReplies(
  list: string[],
  rootId: string,
  opts?: PostThreadOptions
): Promise<PostResult> {
  const o = {
    dry: Boolean(opts?.dry),
    paceMs: Math.max(0, opts?.paceMs ?? Number(process.env.X_THREAD_PACE_MS ?? 7000)),
    attempts: Math.max(1, opts?.attempts ?? 5),
    baseBackoffMs: Math.max(200, opts?.baseBackoffMs ?? 1500),
    maxBackoffMs: Math.max(1000, opts?.maxBackoffMs ?? 60_000),
    perCallTimeoutMs: Math.max(1000, opts?.perCallTimeoutMs ?? 8000),
  };

  if (o.dry) return { ids: [], dry: true };
  const bearer = await getFreshXBearer();
  if (!bearer) throw new Error("No OAuth2 bearer. Run /api/x/connect (tweet.write scope).");
  const client = new Client(bearer);

  let lastId = rootId;
  const ids: string[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const r = await createWithRetry(
      client,
      { text: list[i], reply: { in_reply_to_tweet_id: lastId } },
      o.attempts,
      o.baseBackoffMs,
      o.maxBackoffMs,
      o.perCallTimeoutMs
    );
    if (!r.id) throw new Error(r.detail ? `Failed to create reply #${i + 1}: ${r.detail}` : `Failed to create reply #${i + 1}`);
    ids.push(r.id);
    lastId = r.id;
    if (o.paceMs > 0) await sleep(o.paceMs);
  }
  return { ids, dry: false };
}

export async function postThread(
  opener: XPost,
  replies: string[],
  opts?: PostThreadOptions
): Promise<PostResult> {
  if (opts?.dry) return { ids: [], dry: true };
  const root = await postRoot(opener, opts);
  const tail = await postReplies(replies, root.ids[0], opts);
  return { ids: [...root.ids, ...tail.ids], dry: false };
}
