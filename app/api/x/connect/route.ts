// app/api/x/connect/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const clientId = process.env.X_CLIENT_ID;
  const redirect = process.env.X_REDIRECT_URI;
  const secret = process.env.X_CLIENT_SECRET;
  if (!clientId || !redirect || !secret) {
    return NextResponse.json(
      { error: "Missing X env vars (X_CLIENT_ID/SECRET/REDIRECT_URI)" },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();
  // Keep it simple: code_challenge_method 'plain' with the same state
  const url = new URL("https://twitter.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", "tweet.read tweet.write users.read offline.access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", state);
  url.searchParams.set("code_challenge_method", "plain");

  return NextResponse.redirect(url.toString(), {
    headers: {
      "Set-Cookie": `x_oauth_state=${state}; Path=/; HttpOnly; Secure; Max-Age=600; SameSite=Lax`,
    },
  });
}
