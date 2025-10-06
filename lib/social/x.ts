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

async function createWithRetry(client: Client, args: CreateArgs, attempts = 3): Promise<{ id: string | null; detail?: string }> {
  let lastDetail = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await client.tweets.createTweet(args);
      const id = res.data?.id ?? null;
      if (id) return { id };
      lastDetail = "No tweet id in response";
    } catch (e) {
      // try to extract useful details
      if (typeof e === "object" && e && "errors" in (e as any)) {
        // twitter-api-sdk sometimes throws with an object that has .errors
        const err = (e as any);
        lastDetail = JSON.stringify(err.errors ?? err, null, 2);
      } else {
        lastDetail = String(e);
      }
    }
    await sleep(500 * (i + 1)); // 0.5s, 1s backoff
  }
  return { id: null, detail: lastDetail };
}

/** Posts a thread: root tweet then chained replies */
export async function postThread(posts: XPost[], dry = false): Promise<PostResult> {
  const texts = posts.map(p => (p.text ?? "").trim()).filter(Boolean);
  if (texts.length === 0) return { ids: [], dry };

  if (dry) return { ids: [], dry: true };

  const bearer = await getFreshXBearer();
  if (!bearer) {
    throw new Error("Missing X OAuth2 bearer. Run /api/x/connect to authorize.");
  }

  const client = new Client(bearer);
  const ids: string[] = [];

  // Root tweet
  const rootTry = await createWithRetry(client, { text: texts[0] });
  if (!rootTry.id) {
    throw new Error(rootTry.detail ? `Failed to create root tweet: ${rootTry.detail}` : "Failed to create root tweet.");
  }
  ids.push(rootTry.id);

  // Replies
  let lastId = rootTry.id;
  for (let i = 1; i < texts.length; i += 1) {
    const resp = await createWithRetry(client, { text: texts[i], reply: { in_reply_to_tweet_id: lastId } });
    if (!resp.id) {
      throw new Error(resp.detail ? `Failed to create reply #${i}: ${resp.detail}` : `Failed to create reply #${i}`);
    }
    ids.push(resp.id);
    lastId = resp.id;
    await sleep(300);
  }

  return { ids, dry: false };
}
