import { NextRequest, NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery } from "@/lib/db";
import { Buffer } from "node:buffer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("x_oauth_state")?.value ?? "";
  const codeVerifier = req.cookies.get("x_oauth_verifier")?.value ?? "";

  if (!code || !state) return NextResponse.json({ step: "pre", error: "missing code/state" }, { status: 400 });
  if (state !== cookieState) return NextResponse.json({ step: "pre", error: "state mismatch (host/cookie)" }, { status: 400 });
  if (!codeVerifier) return NextResponse.json({ step: "pre", error: "missing code_verifier cookie" }, { status: 400 });

  const clientId = process.env.X_CLIENT_ID!;
  const clientSecret = process.env.X_CLIENT_SECRET!;
  const redirectUri = process.env.X_REDIRECT_URI!;

  try {
    // 1) Token exchange
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const resp = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return NextResponse.json({ step: "token", error: "token exchange failed", detail }, { status: 500 });
    }

    const tok = (await resp.json()) as {
      token_type: "bearer";
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    // 2) Username fetch (optional)
    let username = "unknown";
    try {
      const client = new Client(tok.access_token);
      const me = await client.users.findMyUser();
      username = me.data?.username ?? "unknown";
    } catch (e) {
      return NextResponse.json({ step: "me", error: "users.findMyUser failed", detail: String(e) }, { status: 500 });
    }

    // 3) DB insert
    const expiresAt =
      typeof tok.expires_in === "number" ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null;

    try {
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
        [username, tok.access_token, tok.refresh_token ?? null, expiresAt]
      );
    } catch (e) {
      return NextResponse.json({ step: "db", error: "db insert failed", detail: String(e) }, { status: 500 });
    }

    // Success (don’t show tokens)
    return NextResponse.json({
      ok: true,
      step: "done",
      username,
      hasRefresh: Boolean(tok.refresh_token),
      expiresAt,
    });
  } catch (e) {
    return NextResponse.json({ step: "catch", error: String(e) }, { status: 500 });
  }
}
