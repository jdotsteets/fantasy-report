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

async function createWithRetry(client: Client, args: CreateArgs, attempts = 3): Promise<string | null> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await client.tweets.createTweet(args);
      const id = res.data?.id ?? null;
      if (id) return id;
      lastErr = new Error("No tweet id in response");
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * (i + 1)); // 0.5s, 1s
  }

  console.warn("[x.postThread] createTweet failed:", String(lastErr));
  return null;
}

/** Posts a thread: first tweet, then replies chained to previous. */
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

  const rootId = await createWithRetry(client, { text: texts[0] });
  if (!rootId) throw new Error("Failed to create root tweet.");
  ids.push(rootId);

  let lastId = rootId;
  for (let i = 1; i < texts.length; i += 1) {
    const id = await createWithRetry(client, { text: texts[i], reply: { in_reply_to_tweet_id: lastId } });
    if (!id) throw new Error(`Failed to create reply index=${i}`);
    ids.push(id);
    lastId = id;
    await sleep(300);
  }

  return { ids, dry: false };
}
