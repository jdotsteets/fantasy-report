import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParamShape = { key: string };

function keyVariants(key: string): string[] {
  // Accept raw "justin-jefferson" and "nfl:name:justin-jefferson"
  const bare = key.startsWith("nfl:name:") ? key.slice("nfl:name:".length) : key;
  return [bare, `nfl:name:${bare}`];
}

export async function GET(
  req: NextRequest,
  { params }: { params: ParamShape }
) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") || 60), 365));
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 50), 200));

  const rawKey = params?.key ?? "";
  const decoded = decodeURIComponent(rawKey).trim();
  if (!decoded) {
    return NextResponse.json({ ok: false, error: "invalid_key" }, { status: 400 });
  }

  const variants = keyVariants(decoded);

  try {
    const { rows } = await dbQuery<{
      id: number;
      title: string;
      url: string;
      domain: string;
      source: string;
      primary_topic: string | null;
      is_player_page: boolean | null;
      ts: string;
      image_url: string | null;
    }>(
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
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE COALESCE(a.published_at, a.discovered_at) >= NOW() - ($1 || ' days')::interval
        AND a.players && $2::text[]          -- overlap operator: any variant present
      ORDER BY ts DESC NULLS LAST, a.id DESC
      LIMIT $3
      `,
      [String(days), variants, limit]
    );

    return NextResponse.json({ items: rows }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "query_failed" },
      { status: 500 }
    );
  }
}
