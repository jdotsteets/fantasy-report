import { NextRequest, NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = req.cookies.get("x_oauth_state")?.value ?? "";
    const codeVerifier = req.cookies.get("x_oauth_verifier")?.value ?? "";

    if (!code || !state || state !== cookieState || !codeVerifier) {
      return NextResponse.json({ error: "Invalid OAuth state/verifier" }, { status: 400 });
    }

    const clientId = process.env.X_CLIENT_ID!;
    const redirectUri = process.env.X_REDIRECT_URI!;

    // --- Token exchange (PKCE): put client_id in the body; no Authorization header ---
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    const resp = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!resp.ok) {
      const detail = await resp.text(); // <-- show real reason
      return NextResponse.json({ error: "Token exchange failed", detail }, { status: 500 });
    }

    type TokenResponse = {
      token_type: "bearer";
      access_token: string;
      refresh_token?: string;
      expires_in?: number; // seconds
      scope?: string;
    };

    const tok = (await resp.json()) as TokenResponse;
    const accessToken = tok.access_token;
    const refreshToken = tok.refresh_token ?? null;
    const expiresAt =
      typeof tok.expires_in === "number"
        ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
        : null;

    // Fetch username with the bearer token
    const client = new Client(accessToken);
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

    // Clear short-lived cookies and go to admin
    return NextResponse.redirect(new URL("/admin/social", url.origin), {
      headers: {
        "Set-Cookie": [
          "x_oauth_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
          "x_oauth_verifier=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
        ].join(", "),
      },
    });
  } catch (e) {
    console.error("X OAuth callback failed:", e);
    return NextResponse.json({ error: "OAuth callback failed" }, { status: 500 });
  }
}
