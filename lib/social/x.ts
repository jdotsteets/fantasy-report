// lib/social/x.ts
import { Client } from "twitter-api-sdk";
import { getFreshXBearer } from "@/app/src/social/xAuth";

export type XPost = { text: string };
type PostResult = { ids: string[]; dry: boolean };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type CreateArgs = {
  text: string;
  reply?: { in_reply_to_tweet_id: string };
};

// Robust error serializer for twitter-api-sdk / fetch-style errors
function explainTwitterError(err: unknown): string {
  try {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];

    // Common fields the SDK exposes
    if (typeof e?.name === "string") parts.push(`name=${e.name}`);
    if (typeof e?.message === "string") parts.push(`message=${e.message}`);

    // twitter-api-sdk sometimes attaches .status / .errors / .data
    if (typeof e?.status === "number") parts.push(`status=${e.status}`);
    if (e?.errors) parts.push(`errors=${JSON.stringify(e.errors)}`);
    if (e?.data) parts.push(`data=${JSON.stringify(e.data)}`);

    // Some builds expose a Response-like object
    const res = e?.response as Response | undefined;
    if (res && typeof res.status === "number") {
      parts.push(`httpStatus=${res.status}`);
      // @ts-expect-error – not always present, runtime guard above
      const body = (e as any).responseBody ?? (e as any).body ?? null;
      if (body) parts.push(`body=${typeof body === "string" ? body : JSON.stringify(body)}`);
    }

    // Fallback
    if (parts.length === 0) return String(err);
    return parts.join(" | ");
  } catch {
    return String(err);
  }
}

async function createWithRetry(
  client: Client,
  args: CreateArgs,
  attempts = 3
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
    }
    await sleep(500 * (i + 1)); // 0.5s, 1s …
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

  // Root
  const rootTry = await createWithRetry(client, { text: texts[0] });
  if (!rootTry.id) {
    throw new Error(rootTry.detail ? `Failed to create root tweet: ${rootTry.detail}` : "Failed to create root tweet.");
  }
  ids.push(rootTry.id);

  // Replies chained
  let lastId = rootTry.id;
  for (let i = 1; i < texts.length; i += 1) {
    const r = await createWithRetry(client, {
      text: texts[i],
      reply: { in_reply_to_tweet_id: lastId },
    });
    if (!r.id) {
      throw new Error(r.detail ? `Failed to create reply #${i}: ${r.detail}` : `Failed to create reply #${i}`);
    }
    ids.push(r.id);
    lastId = r.id;
    await sleep(300);
  }

  return { ids, dry: false };
}
