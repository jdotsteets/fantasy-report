// app/api/backfill-images/route.ts
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Lazy init so build doesn’t crash if env isn’t present yet
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  // Prefer service role on the server; fall back to anon for read-only
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Don’t throw at module load; return null and handle in GET
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return new Response(
      JSON.stringify({ ok: false, error: "Supabase not configured" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  try {
    // ... your logic using `supabase` ...
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
