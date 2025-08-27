// lib/supabaseServer.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  if (!url || !key) {
    throw new Error("Missing Supabase env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or ANON).");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
