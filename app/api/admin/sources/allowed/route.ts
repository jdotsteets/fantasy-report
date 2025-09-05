// app/api/admin/sources/allowed/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type AnyRow = Record<string, unknown>;
type AnyRows = AnyRow[];

/** Run a query and always return an array of rows, regardless of dbQuery’s shape */
async function tryQuery(sql: string): Promise<AnyRows> {
  // Use <any> to avoid QueryResultRow generic constraints
  const res = await dbQuery<any>(sql, []);
  const rows = Array.isArray(res) ? res : (res as any).rows;
  return (rows ?? []) as AnyRows;
}

export async function GET() {
  try {
    // 1) Preferred: has `allowed`
    try {
      const rows = await tryQuery(`
        SELECT
          id,
          COALESCE(name, NULL)          AS name,
          COALESCE(site, NULL)          AS site,
          COALESCE(homepage_url, NULL)  AS homepage_url,
          COALESCE(feed_url, NULL)      AS feed_url,
          COALESCE(allowed, true)       AS allowed
        FROM sources
        WHERE COALESCE(allowed, true) = true
        ORDER BY id ASC
      `);
      return NextResponse.json({ ok: true, sources: rows });
    } catch {
      // 2) Alternate: has `allowed_to_ingest`
      try {
        const rows = await tryQuery(`
          SELECT
            id,
            COALESCE(name, NULL)              AS name,
            COALESCE(homepage_url, NULL)      AS homepage_url,
            COALESCE(feed_url, NULL)          AS feed_url,
            COALESCE(allowed_to_ingest, true) AS allowed
          FROM sources
          WHERE COALESCE(allowed_to_ingest, true) = true
          ORDER BY id ASC
        `);
        return NextResponse.json({ ok: true, sources: rows });
      } catch {
        // 3) Minimal fallbacks (IDs only)
        try {
          const rows = await tryQuery(`
            SELECT id, COALESCE(allowed, true) AS allowed
            FROM sources
            WHERE COALESCE(allowed, true) = true
            ORDER BY id ASC
          `);
          return NextResponse.json({ ok: true, sources: rows });
        } catch {
          const rows = await tryQuery(`
            SELECT id, COALESCE(allowed_to_ingest, true) AS allowed
            FROM sources
            WHERE COALESCE(allowed_to_ingest, true) = true
            ORDER BY id ASC
          `);
          return NextResponse.json({ ok: true, sources: rows });
        }
      }
    }
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err), stack: err?.stack ?? null },
      { status: 500 }
    );
  }
}
