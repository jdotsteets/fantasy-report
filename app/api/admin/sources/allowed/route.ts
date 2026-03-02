// app/api/admin/sources/allowed/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type AllowedSource = {
  id: number;
  name?: string | null;
  site?: string | null;
  homepage_url?: string | null;
  feed_url?: string | null;
  allowed: boolean;
};

/** dbQuery can return either an array or an object with a `rows` array. */
type ResultLike<T> = T[] | { rows?: T[] };

/** Run a query and always return an array of rows, regardless of dbQuery’s shape */
async function tryQuery<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  const res = (await dbQuery(sql, [])) as ResultLike<T>;
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.rows)) return res.rows;
  return [];
}

function toErrorInfo(err: unknown) {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack ?? null };
  }
  return { message: String(err), stack: null };
}

export async function GET() {
  try {
    // 1) Preferred: table has `allowed`
    try {
      const rows = await tryQuery<AllowedSource>(`
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
      // 2) Alternate: table has `allowed_to_ingest`
      try {
        const rows = await tryQuery<AllowedSource>(`
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
        // 3) Minimal fallbacks (IDs only) — try `allowed` then `allowed_to_ingest`
        try {
          const rows = await tryQuery<AllowedSource>(`
            SELECT id, COALESCE(allowed, true) AS allowed
            FROM sources
            WHERE COALESCE(allowed, true) = true
            ORDER BY id ASC
          `);
          return NextResponse.json({ ok: true, sources: rows });
        } catch {
          const rows = await tryQuery<AllowedSource>(`
            SELECT id, COALESCE(allowed_to_ingest, true) AS allowed
            FROM sources
            WHERE COALESCE(allowed_to_ingest, true) = true
            ORDER BY id ASC
          `);
          return NextResponse.json({ ok: true, sources: rows });
        }
      }
    }
  } catch (err: unknown) {
    const { message, stack } = toErrorInfo(err);
    return NextResponse.json({ ok: false, error: message, stack }, { status: 500 });
  }
}
