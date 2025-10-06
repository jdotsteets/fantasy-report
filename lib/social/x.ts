import { Client } from "twitter-api-sdk";
import { getFreshXBearer } from "@/app/src/social/xAuth";

export type XPost = { text: string };
type PostResult = { ids: string[]; dry: boolean };

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

/** Backoff helper for 429s: exponential + jitter, capped. */
function backoffMs(attempt: number, base = 1500, cap = 60_000): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 400); // 0–400ms
  return exp + jitter;
}

async function createWithRetry(
  client: Client,
  args: CreateArgs,
  attempts = 5
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

      // If we hit a 429, wait and retry
      if (lastDetail.includes("status=429") || lastDetail.includes("httpStatus=429")) {
        await sleep(backoffMs(i)); // 1.5s, 3s, 6s, 12s, 24s (w/ jitter), capped by cap
        continue;
      }
    }
    // small spacing for non-429 transient errors
    await sleep(400);
  }
  return { id: null, detail: lastDetail };
}

export async function postThread(posts: XPost[], dry = false): Promise<PostResult> {
  const texts = posts.map((p) => (p.text ?? "").trim()).filter(Boolean);
  if (texts.length === 0) return { ids: [], dry };
  if (dry) return { ids: [], dry: true };

  const bearer = await getFreshXBearer();
  if (!bearer) {
    throw new Error("No OAuth2 bearer. Run /api/x/connect to authorize (tweet.write scope required).");
  }

  const client = new Client(bearer);
  const ids: string[] = [];

  const rootTry = await createWithRetry(client, { text: texts[0] });
  if (!rootTry.id) {
    throw new Error(rootTry.detail ? `Failed to create root tweet: ${rootTry.detail}` : "Failed to create root tweet.");
  }
  ids.push(rootTry.id);

  let lastId = rootTry.id;
  for (let i = 1; i < texts.length; i += 1) {
    const r = await createWithRetry(client, { text: texts[i], reply: { in_reply_to_tweet_id: lastId } });
    if (!r.id) {
      throw new Error(r.detail ? `Failed to create reply #${i}: ${r.detail}` : `Failed to create reply #${i}`);
    }
    ids.push(r.id);
    lastId = r.id;
    await sleep(300); // light pacing between replies
  }

  return { ids, dry: false };
}
