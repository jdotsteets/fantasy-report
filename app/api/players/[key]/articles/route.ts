// app/api/players/[key]/articles/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";

type Params = { key: string };

// Return newest-first articles for a normalized player key
export async function GET(req: Request, { params }: { params: Promise<Params> }) {
  try {
    const { key: rawKey } = await params; // ← important: await params
    const key = decodeURIComponent(rawKey || "").toLowerCase().trim();
    if (!key || key.length < 2) {
      return NextResponse.json({ error: "bad_key" }, { status: 400 });
    }

    const url = new URL(req.url);
    const days = Number(url.searchParams.get("days") ?? "60");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "40"), 1), 200);

    // slug from key (e.g., "joe mixon" -> "joe-mixon")
    const slug = key.replace(/\s+/g, "-");

    const sql = `
      WITH rows AS (
        SELECT
          a.id,
          COALESCE(a.cleaned_title, a.title)                 AS title,
          REPLACE(a.domain, 'www.', '')                      AS domain,
          a.url,
          s.name                                             AS source,
          a.primary_topic,
          a.is_player_page,
          a.image_url,
          COALESCE(a.published_at, a.discovered_at)          AS ts
        FROM articles a
        JOIN sources s ON s.id = a.source_id
        WHERE COALESCE(a.published_at, a.discovered_at) >= NOW() - ($1 || ' days')::interval
          AND (
            /* A) strict key match for true player pages */
            (
              a.is_player_page IS TRUE
              AND LOWER(REGEXP_REPLACE(
                    COALESCE(
                      CASE
                        WHEN COALESCE(a.cleaned_title, a.title) ~* '^[A-Z][A-Za-z.''-]+( [A-Z][A-Za-z.''-]+){0,3}( (?:Jr|Sr|II|III|IV|V)\\.?)?$'
                          THEN COALESCE(a.cleaned_title, a.title)
                        WHEN a.domain ILIKE '%fantasypros.com%'
                          AND a.url ~* '/nfl/(players|stats|news)/[a-z0-9-]+\\.php$'
                          THEN INITCAP(REPLACE(REGEXP_REPLACE(a.url, '.*/nfl/(?:players|stats|news)/([a-z0-9-]+)\\.php.*', '\\\\1'), '-', ' '))
                        WHEN a.domain ILIKE '%nbcsports.com%'
                          AND a.url ~* '/nfl/[a-z0-9-]+/(?:[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?$'
                          THEN INITCAP(REPLACE(REGEXP_REPLACE(a.url, '.*/nfl/([a-z0-9-]+)/.*', '\\\\1'), '-', ' '))
                        ELSE COALESCE(a.cleaned_title, a.title)
                      END,
                      ''
                    ),
                    '[^A-Za-z0-9 ]', '', 'g'
                  )) = $2
            )
            OR
            /* B) normalized title contains the normalized key */
            REGEXP_REPLACE(LOWER(COALESCE(a.cleaned_title, a.title)), '[^a-z0-9 ]', '', 'g') LIKE ('%' || $2 || '%')
            OR
            /* C) URL contains the slug */
            a.url ~* ('/' || $3 || '(?:\\\\b|/)')
          )
      )
      SELECT
        id, title, url, domain, source, primary_topic, is_player_page,
        ts::text AS ts, image_url
      FROM rows
      ORDER BY ts DESC NULLS LAST
      LIMIT $4;
    `;

    const res = await dbQuery(sql, [String(days), key, slug, String(limit)]);
    return NextResponse.json({ items: res.rows });
  } catch (err) {
    console.error("[/api/players/:key/articles] error", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
