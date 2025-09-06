// app/api/admin/article-probe/commit/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const runtime = "nodejs";

type Body = {
  id?: number | null; // if present → update this row
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
  const body = (await req.json().catch(() => (null))) as Body | null;
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

  // If id provided → update
  if (typeof id === "number" && Number.isFinite(id)) {
    try {
      const { rows } = await pool.query<{ id: number }>(
        `
        update articles set
          source_id = $2,
          url = $3,
          canonical_url = $4,
          title = $5,
          author = $6,
          published_at = $7,
          domain = $8,
          is_static = $9,
          static_type = $10
        where id = $1
        returning id
        `,
        [
          id,
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "update failed";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
  }

  // No id → dedupe check by url/canonical (both user-set and probed)
  let existingId: number | null = null;
  try {
    const { rows } = await pool.query<{ id: number }>(
      `
      select id from articles
      where url = $1
         or canonical_url = $1
         or ($2 is not null and (url = $2 or canonical_url = $2))
         or ($3 is not null and (url = $3 or canonical_url = $3))
      order by id asc
      limit 1
      `,
      [url, canonical_url, probed_canonical]
    );
    existingId = rows[0]?.id ?? null;
  } catch {
    existingId = null;
  }

  if (existingId != null) {
    // Update the existing row instead of inserting a duplicate
    try {
      const { rows } = await pool.query<{ id: number }>(
        `
        update articles set
          source_id = $2,
          url = $3,
          canonical_url = $4,
          title = $5,
          author = $6,
          published_at = $7,
          domain = $8,
          is_static = $9,
          static_type = $10
        where id = $1
        returning id
        `,
        [
          existingId,
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "update failed";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
  }

  // Insert new
  try {
    const { rows } = await pool.query<{ id: number }>(
      `
      insert into articles
        (source_id, url, canonical_url, title, author, published_at, discovered_at,
         domain, is_static, static_type)
      values
        ($1,$2,$3,$4,$5,$6, now(), $7, $8, $9)
      returning id
      `,
      [source_id, url, canonical_url, title, author, published_at, domain, is_static, static_type]
    );
    return NextResponse.json({ ok: true, id: rows[0].id, action: "inserted" as const });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "insert failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
