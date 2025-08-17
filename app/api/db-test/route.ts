// app/api/db-test/route.ts
import { query } from "@/lib/db";

export async function GET() {
  try {
    const res = await query("SELECT NOW()");
    return Response.json({ ok: true, now: res.rows[0] });
  } catch (err: any) {
    console.error("DB test error:", err);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
