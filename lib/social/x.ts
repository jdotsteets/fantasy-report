// lib/social/x.ts
import { Client } from "twitter-api-sdk";
import { getFreshXBearer } from "@/app/src/social/xAuth";

export type XPost = { text: string };
type PostResult = { ids: string[]; dry: boolean };

// Optional tuning from caller (backward compatible with boolean `dry`)
export type PostThreadOptions = {
  dry?: boolean;
  /** Delay between replies (ms). Default 7000 (7s). */
  paceMs?: number;
  /** Max attempts per tweet before failing. Default 5. */
  attempts?: number;
  /** Initial backoff for 429 (ms). Default 1500. */
  baseBackoffMs?: number;
  /** Max backoff (ms). Default 60000. */
  maxBackoffMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type CreateArgs = { text: string; reply?: { in_reply_to_tweet_id: string } };

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
  capMs: number
): Promise<{ id: string | null; detail?: string }> {
  let lastDetail = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await client.tweets.createTweet(args);
      const id = res.data?.id ?? null;
      if (id) return { id };
      lastDetail = "No tweet id in response";
    } catch (e) {
      lastDetail = explainTwitterError(e);
      if (lastDetail.includes("status=429") || lastDetail.includes("httpStatus=429")) {
        await sleep(backoffMs(i, baseMs, capMs));
        continue;
      }
    }
    await sleep(400);
  }
  return { id: null, detail: lastDetail };
}

/**
 * Post a thread: root, then paced replies.
 * Backward-compatible:
 *   - postThread(posts, true)  -> dry run
 *   - postThread(posts, false) -> live, default pacing
 *   - postThread(posts, { dry:false, paceMs:9000 }) -> live w/ custom pacing
 */
export async function postThread(posts: XPost[], opts?: boolean | PostThreadOptions): Promise<PostResult> {
  const texts = posts.map((p) => (p.text ?? "").trim()).filter(Boolean);
  if (texts.length === 0) return { ids: [], dry: Boolean(typeof opts === "boolean" ? opts : opts?.dry) };

  // Normalize options
  const o: Required<PostThreadOptions> = (() => {
    if (typeof opts === "boolean") return { dry: opts, paceMs: 7000, attempts: 5, baseBackoffMs: 1500, maxBackoffMs: 60_000 };
    return {
      dry: Boolean(opts?.dry),
      paceMs: Math.max(0, opts?.paceMs ?? Number(process.env.X_THREAD_PACE_MS ?? 7000)),
      attempts: Math.max(1, opts?.attempts ?? 5),
      baseBackoffMs: Math.max(200, opts?.baseBackoffMs ?? 1500),
      maxBackoffMs: Math.max(1000, opts?.maxBackoffMs ?? 60_000),
    };
  })();

  if (o.dry) return { ids: [], dry: true };

  const bearer = await getFreshXBearer();
  if (!bearer) throw new Error("No OAuth2 bearer. Run /api/x/connect to authorize (tweet.write scope required).");

  const client = new Client(bearer);
  const ids: string[] = [];

  // Root (no pacing before)
  const rootTry = await createWithRetry(client, { text: texts[0] }, o.attempts, o.baseBackoffMs, o.maxBackoffMs);
  if (!rootTry.id) throw new Error(rootTry.detail ? `Failed to create root tweet: ${rootTry.detail}` : "Failed to create root tweet.");
  ids.push(rootTry.id);

  // Replies (paced)
  let lastId = rootTry.id;
  for (let i = 1; i < texts.length; i += 1) {
    if (o.paceMs > 0) await sleep(o.paceMs);
    const r = await createWithRetry(
      client,
      { text: texts[i], reply: { in_reply_to_tweet_id: lastId } },
      o.attempts,
      o.baseBackoffMs,
      o.maxBackoffMs
    );
    if (!r.id) throw new Error(r.detail ? `Failed to create reply #${i}: ${r.detail}` : `Failed to create reply #${i}`);
    ids.push(r.id);
    lastId = r.id;
  }

  return { ids, dry: false };
}

// lib/social/x.ts (append these exports; keep existing code as-is)
export async function postRoot(text: string, opts?: boolean | PostThreadOptions): Promise<{ id: string; dry: boolean }> {
  const o: Required<PostThreadOptions> =
    typeof opts === "boolean"
      ? { dry: opts, paceMs: 0, attempts: 5, baseBackoffMs: 1500, maxBackoffMs: 60_000 }
      : {
          dry: Boolean(opts?.dry),
          paceMs: 0,
          attempts: Math.max(1, opts?.attempts ?? 5),
          baseBackoffMs: Math.max(200, opts?.baseBackoffMs ?? 1500),
          maxBackoffMs: Math.max(1000, opts?.maxBackoffMs ?? 60_000),
        };

  if (o.dry) return { id: "", dry: true };

  const bearer = await getFreshXBearer();
  if (!bearer) throw new Error("No OAuth2 bearer. Run /api/x/connect (tweet.write scope).");

  const client = new Client(bearer);
  const root = await createWithRetry(client, { text }, o.attempts, o.baseBackoffMs, o.maxBackoffMs);
  if (!root.id) throw new Error(root.detail ? `Failed to create root tweet: ${root.detail}` : "Failed to create root tweet.");
  return { id: root.id, dry: false };
}

/** Post replies only (chained to an existing rootId). */
export async function postReplies(
  texts: XPost[],
  rootId: string,
  opts?: boolean | PostThreadOptions
): Promise<{ ids: string[]; dry: boolean }> {
  const list = texts.map(t => (t.text ?? "").trim()).filter(Boolean);
  const o: Required<PostThreadOptions> =
    typeof opts === "boolean"
      ? { dry: opts, paceMs: 7000, attempts: 5, baseBackoffMs: 1500, maxBackoffMs: 60_000 }
      : {
          dry: Boolean(opts?.dry),
          paceMs: Math.max(0, opts?.paceMs ?? Number(process.env.X_THREAD_PACE_MS ?? 7000)),
          attempts: Math.max(1, opts?.attempts ?? 5),
          baseBackoffMs: Math.max(200, opts?.baseBackoffMs ?? 1500),
          maxBackoffMs: Math.max(1000, opts?.maxBackoffMs ?? 60_000),
        };

  if (o.dry) return { ids: [], dry: true };

  const bearer = await getFreshXBearer();
  if (!bearer) throw new Error("No OAuth2 bearer. Run /api/x/connect (tweet.write scope).");

  const client = new Client(bearer);
  const ids: string[] = [];
  let lastId = rootId;

  for (let i = 0; i < list.length; i += 1) {
    if (o.paceMs > 0) await new Promise(r => setTimeout(r, o.paceMs));
    const r = await createWithRetry(
      client,
      { text: list[i], reply: { in_reply_to_tweet_id: lastId } },
      o.attempts,
      o.baseBackoffMs,
      o.maxBackoffMs
    );
    if (!r.id) throw new Error(r.detail ? `Failed to create reply #${i + 1}: ${r.detail}` : `Failed to create reply #${i + 1}`);
    ids.push(r.id);
    lastId = r.id;
  }
  return { ids, dry: false };
}

