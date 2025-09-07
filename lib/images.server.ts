// lib/images.server.ts
import { dbQuery } from "@/lib/db";
import { FALLBACK, isLikelyFavicon } from "./images";

type PickArgs = {
  articleImage?: string | null;
  domain?: string | null;      // e.g. "www.espn.com"
  topic?: string | null;       // e.g. "rankings","waiver-wire","start-sit","dfs","injury","advice","news"
  playerKeys?: string[] | null; // optional keys if you identify players in articles
};

/**
 * Choose the best image with graceful fallbacks:
 *  1) Validated article image
 *  2) Player headshot (player_images)
 *  3) Per-source fallback (source_images)
 *  4) Per-topic fallback (topic_images)
 *  5) Global FALLBACK
 */
export async function pickBestImage(args: PickArgs): Promise<string> {
  const { articleImage, domain, topic, playerKeys } = args;

  // 1) Article image (validate & cache)
  const a = normalize(articleImage);
  if (await isUsable(a)) return a!;

  // 2) Player headshot
  if (playerKeys && playerKeys.length) {
    const { rows } = await dbQuery<{ url: string }>(
      `SELECT url
         FROM player_images
        WHERE key = ANY($1) AND url IS NOT NULL
        LIMIT 1`,
      [playerKeys]
    );
    const p = normalize(rows[0]?.url);
    if (await isUsable(p)) return p!;
  }

  // 3) Source-level fallback
  if (domain) {
    const { rows } = await dbQuery<{ default_url: string }>(
      `SELECT default_url
         FROM source_images
        WHERE domain = $1`,
      [domain]
    );
    const s = normalize(rows[0]?.default_url);
    if (await isUsable(s)) return s!;
  }

  // 4) Topic-level fallback
  if (topic) {
    const { rows } = await dbQuery<{ url: string }>(
      `SELECT url
         FROM topic_images
        WHERE topic = $1`,
      [topic]
    );
    const t = normalize(rows[0]?.url);
    if (await isUsable(t)) return t!;
  }

  // 5) Final fallback
  return FALLBACK;
}

function normalize(u?: string | null): string | null {
  if (!u) return null;
  let s = u.trim();
  if (!s) return null;
  if (s.startsWith("//")) s = "https:" + s;
  if (!/^https?:\/\//i.test(s)) return null;
  if (isLikelyFavicon(s)) return null;
  return s;
}

/**
 * Use a tiny DB cache and a HEAD probe to confirm the URL is an image.
 * Tables:
 *   image_cache(url PK, ok bool, content_type text, bytes int, checked_at timestamptz, proxied_url text)
 */
async function isUsable(u?: string | null): Promise<boolean> {
  if (!u) return false;

  // 1) cache hit
  const c = await dbQuery<{ ok: boolean }>(
    `SELECT ok FROM image_cache WHERE url = $1`,
    [u]
  );
  if (c.rows[0]?.ok === true) return true;

  // 2) probe (HEAD)
  let ok = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5500);
    const res = await fetch(u, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(t);

    const type = res.headers.get("content-type") || "";
    const bytes = Number(res.headers.get("content-length") || "0");

    // "good enough" heuristic for thumbnails
    ok = res.ok && type.startsWith("image/") && bytes > 2000;
    // note: you can proxy/store to your CDN here and persist proxied_url too
    await dbQuery(
      `INSERT INTO image_cache(url, ok, content_type, bytes, checked_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (url) DO UPDATE
         SET ok = EXCLUDED.ok,
             content_type = EXCLUDED.content_type,
             bytes = EXCLUDED.bytes,
             checked_at = now()`,
      [u, ok, type, isNaN(bytes) ? null : bytes]
    );
  } catch {
    await dbQuery(
      `INSERT INTO image_cache(url, ok, checked_at)
       VALUES ($1,false, now())
       ON CONFLICT (url) DO UPDATE SET ok=false, checked_at=now()`,
      [u]
    );
    ok = false;
  }

  return ok;
}
