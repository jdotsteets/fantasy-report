import { NextRequest, NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { getFreshXBearer } from "@/app/src/social/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/x/diag
 * Query:
 *   - live=IUnderstand (optional) → actually post a test tweet (requires tweet.write scope)
 *   - text=... (optional)         → custom text for the test tweet
 *
 * Behavior:
 *   - Always: checks env vars exist, fetches/refreshes bearer, calls users.findMyUser()
 *   - If live=IUnderstand: posts a small test tweet and returns tweet id
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const liveFlag = url.searchParams.get("live") === "IUnderstand";
  const text = (url.searchParams.get("text") ?? "✅ X diag test from TheFantasyReport").slice(0, 250);

  const env = {
    hasClientId: Boolean(process.env.X_CLIENT_ID),
    hasClientSecret: Boolean(process.env.X_CLIENT_SECRET),
    hasRedirectUri: Boolean(process.env.X_REDIRECT_URI),
  };

  // 1) Get/refresh OAuth2 bearer
  let bearer: string | null = null;
  try {
    bearer = await getFreshXBearer();
  } catch (e) {
    return NextResponse.json(
      { ok: false, step: "getFreshXBearer", env, error: String(e) },
      { status: 500 }
    );
  }
  if (!bearer) {
    return NextResponse.json(
      { ok: false, step: "getFreshXBearer", env, error: "No bearer (connect account at /api/x/connect)" },
      { status: 400 }
    );
  }

  // 2) Who am I? (confirms token is valid)
  const client = new Client(bearer);
  let username = "unknown";
  let userId = "unknown";
  try {
    const me = await client.users.findMyUser();
    username = me.data?.username ?? "unknown";
    userId = me.data?.id ?? "unknown";
  } catch (e) {
    return NextResponse.json(
      { ok: false, step: "findMyUser", env, error: String(e) },
      { status: 502 }
    );
  }

  // 3) Optionally post a small test tweet (only if explicitly requested)
  if (liveFlag) {
    try {
      const res = await client.tweets.createTweet({ text });
      const id = res.data?.id ?? null;
      if (!id) {
        return NextResponse.json(
          { ok: false, step: "createTweet", env, username, userId, error: "No tweet id in response" },
          { status: 502 }
        );
      }
      return NextResponse.json({
        ok: true,
        env,
        username,
        userId,
        posted: true,
        tweetId: id,
        note: "Posted because live=IUnderstand was provided.",
      });
    } catch (e) {
      // common failure: 429 rate limit
      return NextResponse.json(
        { ok: false, step: "createTweet", env, username, userId, error: String(e) },
        { status: 502 }
      );
    }
  }

  // Default: no posting—just status
  return NextResponse.json({
    ok: true,
    env,
    username,
    userId,
    posted: false,
    note: "Add ?live=IUnderstand to post a tiny test tweet.",
  });
}
