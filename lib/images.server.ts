// lib/images.server.ts
import { dbQuery } from "@/lib/db";
import { FALLBACK, isLikelyFavicon, isWeakArticleImage } from "./images";

type PickArgs = {
  articleImage?: string | null;
  domain?: string | null;
  topic?: string | null;
  playerKeys?: string[] | null;
};

/* ───────────────────────── In-process memo + concurrency cap ───────────────────────── */

const inFlightChecks = new Map<string, Promise<boolean>>();

class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];
  constructor(max: number) { this.count = max; }
  async acquire(): Promise<() => void> {
    if (this.count > 0) {
      this.count -= 1;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.count -= 1;
        resolve(() => this.release());
      });
    });
  }
  private release(): void {
    this.count += 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

const headSemaphore = new Semaphore(Number(process.env.IMAGE_HEAD_CONCURRENCY ?? 4));

/* ───────────────────────── Public API ───────────────────────── */

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
    const p = normalize(rows?.[0]?.url ?? null);
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
    const s = normalize(rows?.[0]?.default_url ?? null);
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
    const t = normalize(rows?.[0]?.url ?? null);
    if (await isUsable(t)) return t!;
  }

  // 5) Final fallback
  return FALLBACK;
}

/* ───────────────────────── Internals ───────────────────────── */

function isAuthorImage(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (
    u.includes("authoring-images") ||
    u.includes("/byline/") ||
    u.includes("/profile/") ||
    u.includes("/profiles/") ||
    u.includes("headshot") ||
    u.includes("avatar") ||
    u.includes("/authors/") ||
    u.includes("/wp-content/uploads/avatars/")
  ) return true;
  if (/[?&](w|width)=1\d{2}\b/.test(u) && /[?&](h|height)=1\d{2}\b/.test(u)) return true;
  return false;
}


function unwrapNextImageProxy(u: string): string | null {
  try {
    const parsed = new URL(u);
    // Typical patterns:
    //  - https://site.com/_next/image?url=<encoded>&w=...
    //  - https://www.fanduel.com/research/_next/image?url=<encoded>&w=...
    if (parsed.pathname.endsWith("/_next/image")) {
      const raw = parsed.searchParams.get("url");
      if (raw) {
        const decoded = decodeURIComponent(raw);
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function isSignedResizer(u: string): boolean {
  // These often require a referer or a valid signature, and frequently 400/403 on server-side HEAD.
  // Add more if you bump into them.
  return (
    /:\/\/[^/]*masslive\.com\/resizer\//i.test(u) ||
    /:\/\/[^/]*advance\.digital\/resizer\//i.test(u) ||
    /:\/\/[^/]*gannettcdn\.com\/.*width=/i.test(u)
  );
}

/** Normalize + early reject bad candidates (favicon, SVG, weak, author avatar). */
function normalize(u?: string | null): string | null {
  if (!u) return null;
  let s = u.trim();
  if (!s) return null;

    // Unwrap Next.js image optimizer URLs to the original CDN asset
  const unwrapped = unwrapNextImageProxy(s);
  if (unwrapped) s = unwrapped;

  if (s.startsWith("//")) s = "https:" + s;
  if (!/^https?:\/\//i.test(s)) return null;

  if (isSignedResizer(s)) return null;     // skip signed/locked resizers
  if (isLikelyFavicon(s)) return null;
  if (/\.(svg)(\?|#|$)/i.test(s)) return null;
  if (isWeakArticleImage(s)) return null;
  if (isAuthorImage(s)) return null;
  return s;
}

/**
 * HEAD-probe with:
 *  - cache lookup
 *  - in-process memo to avoid duplicate concurrent fetches
 *  - tiny concurrency cap to prevent dogpiles
 *  - shorter timeout to keep TTFB in check
 */
async function isUsable(u?: string | null): Promise<boolean> {
  if (!u) return false;

  // 1) DB cache hit
  const cached = await dbQuery<{ ok: boolean }>(
    `SELECT ok FROM image_cache WHERE url = $1`,
    [u]
  );
  if (cached.rows?.[0]?.ok === true) return true;

  // 2) In-process memo: if a probe is already running, await it
  const existing = inFlightChecks.get(u);
  if (existing) return existing;

  // 3) New probe, memoize now
  const probePromise = (async (): Promise<boolean> => {
    let ok = false;
    const release = await headSemaphore.acquire();
    try {
      const timeoutMs = Number(process.env.IMAGE_HEAD_TIMEOUT_MS ?? 3500);

      // First try HEAD (some CDNs reject or don’t implement)
      let type = "";
      let bytes = 0;
      let headOk = false;

      {
        const ctrl = new AbortController();
        const kill = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetch(u, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
          type = (res.headers.get("content-type") || "").toLowerCase();
          bytes = Number(res.headers.get("content-length") || "0");
          headOk = res.ok && type.startsWith("image/") && bytes > 2000;
        } catch {
          headOk = false;
        } finally {
          clearTimeout(kill);
        }
      }

      if (!headOk) {
        // Fallback: tiny GET (some hosts 400/405 on HEAD)
        const ctrl = new AbortController();
        const tinyGetTimeout = Math.max(2500, timeoutMs - 500);
        const kill = setTimeout(() => ctrl.abort(), tinyGetTimeout);
        try {
          const res = await fetch(u, {
            method: "GET",
            headers: { Range: "bytes=0-0" },
            redirect: "follow",
            signal: ctrl.signal,
          });
          const type2 = (res.headers.get("content-type") || "").toLowerCase();
          const bytes2 = Number(res.headers.get("content-length") || "0");
          ok = res.ok && type2.startsWith("image/") && (Number.isFinite(bytes2) ? bytes2 > 2000 : true);
          type = type2 || type;
          bytes = Number.isFinite(bytes2) ? bytes2 : bytes;
        } catch {
          ok = false;
        } finally {
          clearTimeout(kill);
        }
      } else {
        ok = true;
      }

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
    } finally {
      release();
      // Remove from memo regardless of success/failure so future calls can retry later
      inFlightChecks.delete(u);
    }
    return ok;
  })();

  inFlightChecks.set(u, probePromise);
  return probePromise;
}
