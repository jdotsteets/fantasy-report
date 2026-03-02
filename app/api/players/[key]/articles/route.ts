// app/api/players/[key]/articles/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  title: string | null;
  url: string | null;
  canonical_url: string | null;
  domain: string | null;
  source: string | null;
  primary_topic: string | null;
  is_player_page: boolean | null;
  ts: string;
  image_url: string | null;
};

function bareKey(k: string): string {
  return k.startsWith("nfl:name:") ? k.slice("nfl:name:".length) : k;
}
function keyVariants(k: string): string[] {
  const b = bareKey(k);
  return [b, `nfl:name:${b}`];
}
function displayNameFromKey(k: string): string {
  return bareKey(k)
    .split("-")
    .filter(Boolean)
    .map((p) => (p[0] ? p[0].toUpperCase() : "") + p.slice(1))
    .join(" ");
}

// Normalize dbQuery results (T[] or { rows: T[] })
function toRows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const obj = res as { rows?: T[] };
  return Array.isArray(obj?.rows) ? (obj.rows as T[]) : [];
}

/** Extract `[key]` from /api/players/<key>/articles using the request URL. */
function extractKeyFromUrl(reqUrl: string): string {
  const { pathname } = new URL(reqUrl);
  // matches “…/api/players/<key>/articles” (with or without trailing slash)
  const m = pathname.match(/\/api\/players\/([^/]+)\/articles\/?$/);
  return decodeURIComponent(m?.[1] ?? "");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawKey = extractKeyFromUrl(req.url).trim().toLowerCase();
    if (!rawKey) {
      return NextResponse.json(
        { ok: false, error: "invalid_key", items: [] },
        { status: 400 }
      );
    }

    const days = Math.max(1, Math.min(Number(url.searchParams.get("days") ?? 60), 365));
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50), 200));
    const sport = (url.searchParams.get("sport") || "nfl").toLowerCase();

    const variants = keyVariants(rawKey);

    // Primary: articles that have the player key in the players[] column
    const primary = await dbQuery<Row>(
      `
      SELECT
        a.id,
        COALESCE(a.cleaned_title, a.title) AS title,
        a.url,
        a.canonical_url,
        a.domain,
        s.name AS source,
        a.primary_topic,
        a.is_player_page,
        COALESCE(a.published_at, a.discovered_at) AS ts,
        a.image_url
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE COALESCE(a.published_at, a.discovered_at) >= NOW() - ($1::int || ' days')::interval
        AND a.players && $2::text[]
        AND (a.sport IS NULL OR lower(a.sport) = $3)
      ORDER BY ts DESC NULLS LAST, a.id DESC
      LIMIT $4
      `,
      [String(days), variants, sport, limit]
    );

    let rows = toRows<Row>(primary);

    // Fallback: fuzzy match on title/url if nothing in players[]
    if (rows.length === 0) {
      const name = displayNameFromKey(rawKey);
      const titleLike = `%${name}%`;
      const slugLike = `%${bareKey(rawKey)}%`;

      const fallback = await dbQuery<Row>(
        `
        SELECT
          a.id,
          COALESCE(a.cleaned_title, a.title) AS title,
          a.url,
          a.canonical_url,
          a.domain,
          s.name AS source,
          a.primary_topic,
          a.is_player_page,
          COALESCE(a.published_at, a.discovered_at) AS ts,
          a.image_url
        FROM articles a
        JOIN sources s ON s.id = a.source_id
        WHERE COALESCE(a.published_at, a.discovered_at) >= NOW() - ($1::int || ' days')::interval
          AND (a.sport IS NULL OR lower(a.sport) = $2)
          AND (
            COALESCE(a.cleaned_title, a.title) ILIKE $3
            OR a.url ILIKE $4
            OR a.canonical_url ILIKE $4
          )
        ORDER BY ts DESC NULLS LAST, a.id DESC
        LIMIT $5
        `,
        [String(days), sport, titleLike, slugLike, limit]
      );

      rows = toRows<Row>(fallback);
    }

    return NextResponse.json({ ok: true, items: rows }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, items: [] }, { status: 500 });
  }
}
