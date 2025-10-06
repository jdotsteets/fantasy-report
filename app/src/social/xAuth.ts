// app/src/social/xAuth.ts
import { dbQuery, dbQueryRows } from "@/lib/db";

type TokRow = {
  account_username: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null; // ISO or null
};

function isExpiredOrNear(exp?: string | null, skewMs = 60_000): boolean {
  if (!exp) return false; // no expiry provided: treat as non-expiring
  const t = Date.parse(exp);
  if (Number.isNaN(t)) return false;
  return Date.now() + skewMs >= t;
}

/** Exchange a refresh token for a fresh access token (OAuth2) and persist. */
async function refreshToken(username: string, refreshToken: string): Promise<string | null> {
  const clientId = process.env.X_CLIENT_ID ?? "";
  const clientSecret = process.env.X_CLIENT_SECRET ?? "";
  const redirectUri = process.env.X_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    // eslint-disable-next-line no-console
    console.warn("[xAuth] Missing X_CLIENT_ID / X_CLIENT_SECRET / X_REDIRECT_URI");
    return null;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  const resp = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: params.toString(),
    cache: "no-store",
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.warn("[xAuth] refresh failed:", resp.status, detail);
    return null;
  }

  const tok = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: "bearer";
    scope?: string;
  };

  const expiresAt =
    typeof tok.expires_in === "number"
      ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
      : null;

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
    [username, tok.access_token, tok.refresh_token ?? refreshToken, expiresAt]
  );

  return tok.access_token;
}

/**
 * Returns a usable OAuth2 bearer for X v2 API.
 * Assumes /api/x/connect + /api/x/callback have already stored a row in social_oauth_tokens.
 */
export async function getFreshXBearer(): Promise<string | null> {
  const rows = await dbQueryRows<TokRow>(
    `select account_username, access_token, refresh_token, expires_at
       from social_oauth_tokens
      where platform='x'
      order by updated_at desc nulls last, created_at desc
      limit 1`
  );
  if (rows.length === 0) return null;

  const tok = rows[0];
  if (!isExpiredOrNear(tok.expires_at)) {
    return tok.access_token;
  }

  if (tok.refresh_token) {
    const fresh = await refreshToken(tok.account_username, tok.refresh_token);
    return fresh ?? null;
  }

  return null; // expired and no refresh token
}
