// lib/social/x.ts
import crypto from "crypto";

export type XCreds = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

export type XPost = {
  text: string;
  inReplyToId?: string;
};

function getEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length ? v : null;
}

export function loadCreds(): XCreds | null {
  const apiKey = getEnv("X_API_KEY");
  const apiSecret = getEnv("X_API_SECRET");
  const accessToken = getEnv("X_ACCESS_TOKEN");
  const accessSecret = getEnv("X_ACCESS_SECRET");
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

/**
 * Very small OAuth 1.0 helper for v1.1 statuses/update.
 * We use v1.1 because it’s still the simplest way to create reply chains.
 * If you prefer v2 /labs, we can swap later.
 */
function oauthHeader(
  creds: XCreds,
  method: "POST",
  url: string,
  extraParams: Record<string, string>
): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const baseParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const allParams: Record<string, string> = { ...baseParams, ...extraParams };

  const enc = (s: string) => encodeURIComponent(s).replace(/[!*()']/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const paramString = Object.keys(allParams)
    .sort()
    .map(k => `${enc(k)}=${enc(allParams[k])}`)
    .join("&");

  const baseString = [method.toUpperCase(), enc(url), enc(paramString)].join("&");
  const signingKey = `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

    const headerParams: Record<string, string> = {
    ...baseParams,
    oauth_signature: signature,
    };

    const header =
    "OAuth " +
    Object.keys(headerParams)
        .sort()
        .map(k => `${enc(k)}="${enc(headerParams[k])}"`)
        .join(", ");

    return header;
}

async function postStatus(creds: XCreds, status: string, inReplyToId?: string): Promise<string> {
  const url = "https://api.twitter.com/1.1/statuses/update.json";
  const bodyParams: Record<string, string> = { status };
  if (inReplyToId) {
    bodyParams.in_reply_to_status_id = inReplyToId;
    bodyParams.auto_populate_reply_metadata = "true";
  }

  const auth = oauthHeader(creds, "POST", url, bodyParams);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams(bodyParams).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X API error ${res.status}: ${text}`);
  }

  const json: {
    id_str: string;
  } = await res.json();

  return json.id_str;
}

export async function postThread(posts: XPost[], dryRun: boolean): Promise<{ ids: string[]; dry: boolean }> {
  if (dryRun) {
    return { ids: [], dry: true };
  }
  const creds = loadCreds();
  if (!creds) {
    throw new Error("Missing X credentials. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET.");
  }

  const ids: string[] = [];
  let replyTo: string | undefined = undefined;

  for (const p of posts) {
    const id = await postStatus(creds, p.text, replyTo);
    ids.push(id);
    replyTo = id;
  }

  return { ids, dry: false };
}
