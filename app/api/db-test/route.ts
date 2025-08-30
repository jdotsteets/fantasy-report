// app/api/db-test/route.ts
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";         // ensure Node runtime (not edge)
export const dynamic = "force-dynamic";  // NEVER prerender this route
export const revalidate = 0;             // disable caching for the route

export async function GET() {
  try {
    const { rows } = await dbQuery("select current_user, current_database(), now()");
    return Response.json({ ok: true, result: rows[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
