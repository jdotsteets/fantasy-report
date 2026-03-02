// app/api/x/connect/route.ts
import { NextResponse } from "next/server";
import { auth } from "twitter-api-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Missing X env vars" }, { status: 500 });
  }

  const o = new auth.OAuth2User({
    client_id: clientId,
    client_secret: clientSecret,
    callback: redirectUri,
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
  });

  // PKCE: use a random verifier and a 'plain' challenge = verifier
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomUUID().replace(/-/g, "");

  const url = o.generateAuthURL({
    state,
    code_challenge_method: "plain",
    code_challenge: codeVerifier,
  });

  // Store state + verifier in HttpOnly cookies for the callback
  return NextResponse.redirect(url, {
    headers: {
      "Set-Cookie": [
        `x_oauth_state=${state}; Path=/; HttpOnly; Secure; Max-Age=600; SameSite=Lax`,
        `x_oauth_verifier=${codeVerifier}; Path=/; HttpOnly; Secure; Max-Age=600; SameSite=Lax`,
      ].join(", "),
    },
  });
}
