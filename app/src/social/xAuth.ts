//app/src/social/xAuths.ts

import { dbQuery, dbQueryRows } from "@/lib/db";
import { Buffer } from "node:buffer";

type TokenRow = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null; // ISO
  account_username: string;
};

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return true; // be safe -> refresh
  const t = new Date(expiresAt).getTime();
  const now = Date.now();
  return t - now < 5 * 60 * 1000; // < 5 minutes
}

export async function getFreshXBearer(): Promise<string | null> {
  const rows = await dbQueryRows<TokenRow>(
    `select access_token, refresh_token, expires_at, account_username
       from social_oauth_tokens
      where platform='x'
      order by updated_at desc
      limit 1`
  );
  if (rows.length === 0) return null;

  const row = rows[0];

  // If not expiring soon, use it
  if (row.expires_at && !isExpiringSoon(row.expires_at)) {
    return row.access_token;
  }

  // Need refresh
  if (!row.refresh_token) {
    return row.access_token; // nothing we can do; try with old (may fail)
  }

  const clientId = process.env.X_CLIENT_ID!;
  const clientSecret = process.env.X_CLIENT_SECRET!;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    // OPTIONAL: if your app supports PKCE, some tenants need client_id here too
    // client_id: clientId,
  });

  const resp = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    // leave old token; the tweet call might still succeed if token is valid
    return row.access_token;
  }

  const tok = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number; // seconds
  };

  const newAccess = tok.access_token;
  const newRefresh = tok.refresh_token ?? row.refresh_token;
  const newExpiresAt = typeof tok.expires_in === "number"
    ? new Date(Date.now() + tok.expires_in * 1000).toISOString()
    : row.expires_at;

  await dbQuery(
    `update social_oauth_tokens
        set access_token = $1,
            refresh_token = $2,
            expires_at = $3,
            updated_at = now()
      where platform='x'`,
    [newAccess, newRefresh, newExpiresAt]
  );

  return newAccess;
}
