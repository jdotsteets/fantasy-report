// lib/upload.ts
import { getSupabaseAdmin } from "@/lib/supabaseServer";

/** Best-effort content-type sniffing */
function sniffContentType(src: string, hdr: string | null): string {
  if (hdr && /^image\//i.test(hdr)) return hdr.split(";")[0].trim();
  const s = src.toLowerCase();
  if (s.endsWith(".png")) return "image/png";
  if (s.endsWith(".webp")) return "image/webp";
  if (s.endsWith(".gif")) return "image/gif";
  if (s.endsWith(".jpg") || s.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

/**
 * Download a remote image and store it in Supabase Storage.
 * @param remoteUrl - full URL to the image
 * @param objectPath - e.g. "article-images/123.jpg"
 * @returns public URL
 */
export async function cacheRemoteImageToSupabase(
  remoteUrl: string,
  objectPath: string
): Promise<string> {
  // Lazy client (no top-level createClient → no build-time env crash)
  const supabase = getSupabaseAdmin();
  const bucket = process.env.SUPABASE_BUCKET ?? "public"; // keep your current bucket

  const resp = await fetch(remoteUrl, {
    headers: { "user-agent": "FantasyReportBot/1.0" },
  });
  if (!resp.ok) {
    throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  }

  // Works in Node and Edge runtimes
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const contentType = sniffContentType(remoteUrl, resp.headers.get("content-type"));

  const upload = await supabase.storage
    .from(bucket)
    .upload(objectPath, bytes, { contentType, upsert: true });

  if (upload.error) {
    throw new Error(`Supabase upload error: ${upload.error.message}`);
  }

  const pub = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return pub.data.publicUrl;
}
