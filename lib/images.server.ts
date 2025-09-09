// lib/images.server.ts
import { dbQuery } from "@/lib/db";
import { FALLBACK, isLikelyFavicon, isWeakArticleImage } from "./images";

type PickArgs = {
  /** Raw image URL already on the article (e.g. scraped/ingested). */
  articleImage?: string | null;
  /** Article domain (used to pick a per-source fallback). */
  domain?: string | null;           // e.g. "www.espn.com"
  /** Canonical topic used for topic fallbacks. */
  topic?: string | null;            // "rankings" | "waiver-wire" | "start-sit" | "dfs" | "injury" | "advice" | "news"
  /** Optional player keys to allow headshot fallback. */
  playerKeys?: string[] | null;     // e.g. ["nfl:name:justin-jefferson"]
};

/**
 * Choose the best image with graceful fallbacks:
 *  1) Validated article image (reject favicons/author avatars/weak)
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
    const p = normalize(rows?.[0]?.url);
    if (await isUsable(p)) return p!;
  }

  // 3) Source-level fallback
  if (domain) {
    const { rows } = await dbQuery<{ default_url: string }>(
      `SELECT default_url
         FROM source_images
        WHERE domain = $1
        LIMIT 1`,
      [domain]
    );
    const s = normalize(rows?.[0]?.default_url);
    if (await isUsable(s)) return s!;
  }

  // 4) Topic-level fallback
  if (topic) {
    const { rows } = await dbQuery<{ url: string }>(
      `SELECT url
         FROM topic_images
        WHERE topic = $1
        LIMIT 1`,
      [topic]
    );
    const t = normalize(rows?.[0]?.url);
    if (await isUsable(t)) return t!;
  }

  // 5) Final fallback
  return FALLBACK;
}

/* ───────────────────────── Internals ───────────────────────── */

function isAuthorImage(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();

  // Common author/byline/avatar patterns we see across Yahoo/USAToday/Wire/CDNs
  if (
    u.includes("authoring-images") ||      // Gannett / USA Today network
    u.includes("/byline/") ||
    u.includes("/profile/") ||
    u.includes("/profiles/") ||
    u.includes("headshot") ||
    u.includes("avatar") ||
    u.includes("/authors/") ||
    u.includes("/wp-content/uploads/avatars/")
  ) return true;

  // Small-square hints in query params often used for profile pics
  // e.g. ?width=144&height=144
  if (/[?&](w|width)=1\d{2}\b/.test(u) && /[?&](h|height)=1\d{2}\b/.test(u)) return true;

  return false;
}

/** Normalize + early reject bad candidates (favicon, SVG, weak, author avatar). */
function normalize(u?: string | null): string | null {
  if (!u) return null;
  let s = u.trim();
  if (!s) return null;

  if (s.startsWith("//")) s = "https:" + s;
  if (!/^https?:\/\//i.test(s)) return null;

  // Early rejections
  if (isLikelyFavicon(s)) return null;
  if (/\.(svg)(\?|#|$)/i.test(s)) return null;
  if (isWeakArticleImage(s)) return null; // 1x1, tracker gifs, placeholder-y patterns
  if (isAuthorImage(s)) return null;      // 🚫 byline / avatar images

  return s;
}

/**
 * Use a tiny DB cache and a HEAD probe to confirm the URL is an image.
 * Table should exist as:
 *   image_cache(
 *     url text primary key,
 *     ok boolean,
 *     content_type text,
 *     bytes int,
 *     checked_at timestamptz,
 *     proxied_url text  -- optional
 *   )
 */
async function isUsable(u?: string | null): Promise<boolean> {
  if (!u) return false;

  // 1) Cache hit
  const cached = await dbQuery<{ ok: boolean }>(
    `SELECT ok FROM image_cache WHERE url = $1`,
    [u]
  );
  if (cached.rows?.[0]?.ok === true) return true;

  // 2) Probe via HEAD
  let ok = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5500);
    const res = await fetch(u, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(t);

    const type = (res.headers.get("content-type") || "").toLowerCase();
    const bytes = Number(res.headers.get("content-length") || "0");

    // "good enough" heuristic; HEAD content-type must look like an image and be non-tiny
    ok = res.ok && type.startsWith("image/") && bytes > 2000;

    await dbQuery(
      `INSERT INTO image_cache(url, ok, content_type, bytes, checked_at)
       VALUES ($1,$2,$3,$4, NOW())
       ON CONFLICT (url) DO UPDATE
         SET ok = EXCLUDED.ok,
             content_type = EXCLUDED.content_type,
             bytes = EXCLUDED.bytes,
             checked_at = NOW()`,
      [u, ok, type, Number.isFinite(bytes) ? bytes : null]
    );
  } catch {
    await dbQuery(
      `INSERT INTO image_cache(url, ok, checked_at)
       VALUES ($1,false,NOW())
       ON CONFLICT (url) DO UPDATE
         SET ok=false, checked_at=NOW()`,
      [u]
    );
    ok = false;
  }

  return ok;
}
