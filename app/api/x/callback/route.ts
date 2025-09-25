import { NextRequest, NextResponse } from "next/server";
import { auth, Client } from "twitter-api-sdk";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("x_oauth_state")?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  const o = new auth.OAuth2User({
    client_id: process.env.X_CLIENT_ID!,
    client_secret: process.env.X_CLIENT_SECRET!,
    callback: process.env.X_REDIRECT_URI!,
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
  });

  // Exchange code → tokens (populates o.token)
  await o.requestAccessToken(code);

  const tok = o.token; // type Token | undefined
  if (!tok || typeof tok.access_token !== "string") {
    return NextResponse.json({ error: "No access token from X" }, { status: 500 });
  }

  const accessToken = tok.access_token;
  const refreshToken = typeof tok.refresh_token === "string" ? tok.refresh_token : null;

  // In this SDK, expiry is `expires_at` (unix seconds). Coerce to ISO if present.
  const expiresAt =
    typeof tok.expires_at === "number"
      ? new Date(tok.expires_at * 1000).toISOString()
      : null;

  // Fetch username (handy for multi-account later)
  const client = new Client(o);
  const me = await client.users.findMyUser();
  const username = me.data?.username ?? "unknown";

  await dbQuery(
    `
    insert into social_oauth_tokens (platform, account_username, access_token, refresh_token, expires_at)
    values ('x', $1, $2, $3, $4)
    on conflict (platform, account_username)
    do update set access_token = excluded.access_token,
                  refresh_token = excluded.refresh_token,
                  expires_at   = excluded.expires_at,
                  updated_at   = now()
    `,
    [username, accessToken, refreshToken, expiresAt]
  );

  return NextResponse.redirect(new URL("/admin/social", url.origin));
}
