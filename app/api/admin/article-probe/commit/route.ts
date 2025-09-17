// app/api/admin/article-probe/commit/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const runtime = "nodejs";

type Body = {
  id?: number | null;
  url: string;
  canonical_url: string | null;
  title: string | null;
  author: string | null;
  published_at: string | null; // ISO or null
  source_id: number | null;
  is_static: boolean;
  static_type: string | null;
  domain: string | null;
  probed_canonical: string | null;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !body.url) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const {
    id,
    url,
    canonical_url,
    title,
    author,
    published_at,
    source_id,
    is_static,
    static_type,
    domain,
    probed_canonical,
  } = body;

  // 1) Find the "true" target row we should edit (prefer any row that already
  //    has this url/canonical/probed canonical). If none, fall back to the id
  //    the UI sent. If still none, we will insert.
  let targetId: number | null = null;
  try {
    const { rows } = await pool.query<{ id: number }>(
      `
      SELECT id
      FROM articles
      WHERE url = $1
         OR canonical_url = $1
         OR ($2 IS NOT NULL AND (url = $2 OR canonical_url = $2))
         OR ($3 IS NOT NULL AND (url = $3 OR canonical_url = $3))
      ORDER BY id ASC
      LIMIT 1
      `,
      [url, canonical_url, probed_canonical]
    );
    targetId = rows[0]?.id ?? null;
  } catch {
    targetId = null;
  }
  if (targetId == null && typeof id === "number" && Number.isFinite(id)) {
    targetId = id;
  }

  // 2) If we have a target row, UPDATE it (no insert, no conflicts).
  if (targetId != null) {
    try {
      const { rows } = await pool.query<{ id: number }>(
        `
        UPDATE articles SET
          source_id     = $2,
          url           = $3,
          canonical_url = $4,
          title         = $5,
          author        = $6,
          published_at  = $7,
          domain        = $8,
          is_static     = $9,
          static_type   = $10
        WHERE id = $1
        RETURNING id
        `,
        [
          targetId,
          source_id,
          url,
          canonical_url,
          title,
          author,
          published_at,
          domain,
          is_static,
          static_type,
        ]
      );
      return NextResponse.json({ ok: true, id: rows[0].id, action: "updated" as const });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "update failed";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
  }

  // 3) Otherwise INSERT a new row. We’ll try url first; if the conflict is on
  //    canonical_url we retry with that constraint. This avoids 23505 surfacing.
  try {
    const { rows } = await pool.query<{ id: number }>(
      `
      INSERT INTO articles
        (source_id, url, canonical_url, title, author, published_at, discovered_at,
         domain, is_static, static_type)
      VALUES
        ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9)
      ON CONFLICT (url) DO UPDATE SET
        source_id     = EXCLUDED.source_id,
        canonical_url = EXCLUDED.canonical_url,
        title         = COALESCE(EXCLUDED.title, articles.title),
        author        = COALESCE(EXCLUDED.author, articles.author),
        published_at  = COALESCE(EXCLUDED.published_at, articles.published_at),
        domain        = COALESCE(EXCLUDED.domain, articles.domain),
        is_static     = EXCLUDED.is_static,
        static_type   = EXCLUDED.static_type
      RETURNING id
      `,
      [source_id, url, canonical_url, title, author, published_at, domain, is_static, static_type]
    );
    return NextResponse.json({ ok: true, id: rows[0].id, action: "inserted" as const });
  } catch (e: any) {
    // Retry for canonical_url unique conflicts (constraint name from your DB)
    if (e?.code === "23505") {
      try {
        const { rows } = await pool.query<{ id: number }>(
          `
          INSERT INTO articles
            (source_id, url, canonical_url, title, author, published_at, discovered_at,
             domain, is_static, static_type)
          VALUES
            ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9)
          ON CONFLICT ON CONSTRAINT uniq_articles_canonical_url DO UPDATE SET
            source_id     = EXCLUDED.source_id,
            url           = EXCLUDED.url,
            title         = COALESCE(EXCLUDED.title, articles.title),
            author        = COALESCE(EXCLUDED.author, articles.author),
            published_at  = COALESCE(EXCLUDED.published_at, articles.published_at),
            domain        = COALESCE(EXCLUDED.domain, articles.domain),
            is_static     = EXCLUDED.is_static,
            static_type   = EXCLUDED.static_type
          RETURNING id
          `,
          [source_id, url, canonical_url, title, author, published_at, domain, is_static, static_type]
        );
        return NextResponse.json({ ok: true, id: rows[0].id, action: "upserted" as const });
      } catch (e2: unknown) {
        const msg2 = e2 instanceof Error ? e2.message : "insert failed";
        return NextResponse.json({ ok: false, error: msg2 }, { status: 400 });
      }
    }
    const msg = e instanceof Error ? e.message : "insert failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
