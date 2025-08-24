// lib/upload.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // server-side only
);

export async function cacheRemoteImageToSupabase(remoteUrl: string, key: string) {
  const resp = await fetch(remoteUrl);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const contentType = resp.headers.get("content-type") || "image/jpeg";
  const path = `article-images/${key}`;
  const { error } = await supabase.storage.from("public").upload(path, buf, {
    contentType,
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from("public").getPublicUrl(path);
  return data.publicUrl;
}
