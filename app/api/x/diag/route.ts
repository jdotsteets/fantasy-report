import { NextRequest, NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { getFreshXBearer } from "@/app/src/social/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function backoff(attempt: number, base = 1500, cap = 60_000) {
  const exp = Math.min(cap, base * 2 ** attempt);
  return exp + Math.floor(Math.random() * 400);
}
function explain(err: unknown): string {
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
    const body =
      typeof (e as any)?.responseBody === "string" ? (e as any).responseBody :
      typeof (e as any)?.body === "string" ? (e as any).body : null;
    if (body) parts.push(`body=${body}`);
    return parts.length ? parts.join(" | ") : String(err);
  } catch { return String(err); }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const live = url.searchParams.get("live") === "IUnderstand";
  const text = (url.searchParams.get("text") ?? "✅ X diag test").slice(0, 250);
  const attempts = Math.max(1, Number(url.searchParams.get("attempts") ?? 3));
  const baseBackoffMs = Math.max(200, Number(url.searchParams.get("baseBackoffMs") ?? 1500));
  const maxBackoffMs = Math.max(1000, Number(url.searchParams.get("maxBackoffMs") ?? 60000));

  const env = {
    hasClientId: !!process.env.X_CLIENT_ID,
    hasClientSecret: !!process.env.X_CLIENT_SECRET,
    hasRedirectUri: !!process.env.X_REDIRECT_URI,
  };

  let bearer: string | null = null;
  try {
    bearer = await getFreshXBearer();
  } catch (e) {
    return NextResponse.json({ ok: false, step: "getFreshXBearer", env, error: String(e) }, { status: 500 });
  }
  if (!bearer) {
    return NextResponse.json({ ok: false, step: "getFreshXBearer", env, error: "No bearer (run /api/x/connect)" }, { status: 400 });
  }

  const client = new Client(bearer);

  // confirm token is valid
  let username = "unknown", userId = "unknown";
  try {
    const me = await client.users.findMyUser();
    username = me.data?.username ?? "unknown";
    userId = me.data?.id ?? "unknown";
  } catch (e) {
    return NextResponse.json({ ok: false, step: "findMyUser", env, error: explain(e) }, { status: 502 });
  }

  if (!live) {
    return NextResponse.json({ ok: true, env, username, userId, posted: false, note: "Add ?live=IUnderstand to try a tiny post." });
  }

  // try posting (with brief 429 backoff)
  let lastDetail = "";
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await client.tweets.createTweet({ text });
      const id = res.data?.id ?? null;
      if (!id) return NextResponse.json({ ok: false, step: "createTweet", username, userId, error: "No tweet id in response" }, { status: 502 });
      return NextResponse.json({ ok: true, env, username, userId, posted: true, tweetId: id });
    } catch (e) {
      lastDetail = explain(e);
      if (lastDetail.includes("429")) {
        await sleep(backoff(i, baseBackoffMs, maxBackoffMs));
        continue;
      }
      break;
    }
  }
  return NextResponse.json({ ok: false, step: "createTweet", env, username, userId, error: lastDetail || "Unknown error" }, { status: 502 });
}
