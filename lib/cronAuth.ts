import { NextRequest } from "next/server";

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  const m = h ? /^Bearer\s+(.+)$/i.exec(h) : null;
  return m ? m[1] : null;
}

/**
 * Accepts Vercel Cron auth (Authorization: Bearer <CRON_SECRET>)
 * plus legacy x-cron-secret/query fallback.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("cron_secret");
  const auth = bearer(req);

  return header === secret || query === secret || auth === secret;
}
