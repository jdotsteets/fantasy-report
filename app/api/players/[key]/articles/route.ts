// app/api/players/[key]/articles/route.ts
import type { NextRequest } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function keyVariants(key: string): string[] {
  const bare = key.startsWith("nfl:name:") ? key.slice("nfl:name:".length) : key;
  return [bare, `nfl:name:${bare}`];
}

type ResultLike<T> = T[] | { rows?: T[] };
function toRows<T>(res: unknown): T[] {
  const v = res as ResultLike<T>;
  if (Array.isArray(v)) return v;
  return Array.isArray(v.rows) ? v.rows : [];
}

type Row = {
  id: number;
  title: string;
  url: string;
  domain: string;
  source: string;
  primary_topic: string | null;
  is_player_page: boolean | null;
  ts: string;
  image_url: string | null;
};

/** Extract `[key]` from /api/players/[key]/articles */
function getKeyFromPath(pathname: string): string | null {
  // matches “…/api/players/<key>/articles” (with or without trailing slash)
  const m = /\/api\/players\/([^/]+)\/articles\/?$/.exec(pathname);
  return m?.[1] ?? null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") ?? 60), 365));
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50), 200));

  const rawKey = getKeyFromPath(url.pathname) ?? "";
  const decoded = decodeURIComponent(rawKey).trim();
  if (!decoded) {
    return Response.json({ ok: false, error: "invalid_key" }, { status: 400 });
  }

  const variants = keyVariants(decoded);

  try {
    const res = await dbQuery<Row>(
      `
      SELECT
        a.id,
        COALESCE(a.cleaned_title, a.title) AS title,
        a.url,
        a.domain,
        s.name AS source,
        a.primary_topic,
        a.is_player_page,
        COALESCE(a.published_at, a.discovered_at) AS ts,
        a.image_url
        s.provider
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE COALESCE(a.published_at, a.discovered_at) >= NOW() - ($1 || ' days')::interval
        AND a.players && $2::text[]  -- any player key variant present
      ORDER BY ts DESC NULLS LAST, a.id DESC
      LIMIT $3
      `,
      [String(days), variants, limit]
    );

    const rows = toRows<Row>(res);
    return Response.json({ items: rows }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
