// app/api/ingest/route.ts
import Parser from "rss-parser";
import { query } from "@/lib/db";
import { enrich } from "@/lib/enrich";

export const runtime = "nodejs";
export const maxDuration = 60;

/** ---------- Types ---------- */
type DBSource = {
  name: string;
  rss_url: string | null;
  homepage_url: string | null;
  favicon_url: string | null;
  priority: number | null;
};

type ErrorEntry = { source: string; error: string };
type StatEntry = {
  source: string;
  added: number;
  finalUrl: string | null;
  tried: string[];
  discovered?: string | null;
};

type Itemish = {
  link?: string;
  title?: string;
  isoDate?: string;
};

/** ---------- Tunables ---------- */
const USER_AGENT = "FantasyAggregatorBot/0.1 (+contact: you@example.com)";
const MAX_ITEMS_PER_FEED = 150;
const FETCH_TIMEOUT_MS = 12_000;
const RETRIES = 2;

/** ---------- Small utils ---------- */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function safeSlice(s: string | null | undefined, n: number) {
  return (s ?? "").slice(0, n);
}

// B) Sanitize XML: escape bare '&' and strip control chars
function sanitizeXml(xml: string) {
  const ampFixed = xml.replace(
    /&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9A-Fa-f]+;)/g,
    "&amp;"
  );
  const noCtrl = ampFixed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return noCtrl;
}

function normalizeCandidates(url: string | null | undefined): string[] {
  if (!url) return [];
  const variants = new Set<string>();
  const trimmed = url.trim();

  variants.add(trimmed);                                   // original
  variants.add(trimmed.replace(/\/+$/, ""));               // strip trailing slash
  if (trimmed.startsWith("http://"))                       // upgrade http→https
    variants.add("https://" + trimmed.slice(7));
  if (!/\/(feed|rss)(\.xml)?$/i.test(trimmed)) {           // common WordPress variants
    const base = trimmed.replace(/\/+$/, "");
    variants.add(base + "/feed");
    variants.add(base + "/rss");
  }
  return [...variants];
}

// A) Include strong Accept header for picky servers (e.g., 406)
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS
) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        "accept":
          "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
        ...(init.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function robustGet(url: string, retries = RETRIES): Promise<Response> {
  let attempt = 0;
  let lastErr: any = null;

  while (attempt <= retries) {
    try {
      const res = await fetchWithTimeout(url);
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e: any) {
      lastErr = e;
    }
    attempt++;
    if (attempt <= retries) await sleep(400 * attempt);
  }
  throw lastErr ?? new Error("Fetch failed");
}

/** Discover <link rel="alternate" type="application/rss+xml" ...> on a page */
async function discoverRssFromHomepage(homepageUrl: string): Promise<string | null> {
  try {
    const res = await robustGet(homepageUrl);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(
      /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i
    );
    if (!m) return null;
    const found = m[2];
    return new URL(found, homepageUrl).toString(); // resolve relative href
  } catch {
    return null;
  }
}

/** Try candidate URLs; if all fail, try homepage discovery */
async function loadFeedXmlWithFallbacks(
  initialRssUrl: string | null | undefined,
  homepageUrl: string | null | undefined
): Promise<{
  xml: string | null;
  finalUrl: string | null;
  tried: string[];
  discovered: string | null;
  error: string | null;
}> {
  const tried: string[] = [];
  let discovered: string | null = null;

  // 1) Try variants of the stored RSS URL
  for (const u of normalizeCandidates(initialRssUrl)) {
    tried.push(u);
    try {
      const res = await robustGet(u);
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text?.trim().startsWith("<")) {
        return { xml: text, finalUrl: u, tried, discovered, error: null };
      }
    } catch {
      // continue
    }
  }

  // 2) Autodiscover from homepage (if available)
  if (homepageUrl) {
    try {
      const disc = await discoverRssFromHomepage(homepageUrl);
      if (disc) {
        discovered = disc;
        tried.push(disc);
        const res = await robustGet(disc);
        if (res.ok) {
          const text = await res.text();
          if (text?.trim().startsWith("<")) {
            return { xml: text, finalUrl: disc, tried, discovered, error: null };
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    xml: null,
    finalUrl: null,
    tried,
    discovered,
    error: "No working RSS URL found (404s or invalid XML)",
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  // (optional) auth
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  const urlKey = url.searchParams.get("key") || "";
  if (secret && authHeader !== `Bearer ${secret}` && urlKey !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  // NOTE: add parentheses so 'allowed' applies to both rss_url OR homepage_url
  const { rows: sources } = await query<DBSource>(
    `
    SELECT name, rss_url, homepage_url, favicon_url, COALESCE(priority,0) AS priority
      FROM sources
     WHERE (rss_url IS NOT NULL OR homepage_url IS NOT NULL)
       AND allowed IS DISTINCT FROM false
     ORDER BY priority DESC, created_at ASC
    `,
    []
  );

  const parser = new Parser({ headers: { "user-agent": USER_AGENT } });

  let inserted = 0;
  const errors: ErrorEntry[] = [];
  const stats: StatEntry[] = [];

  for (const src of sources) {
    const srcName = src.name;
    let addedForSource = 0;

    try {
      const { xml, finalUrl, tried, discovered, error } =
        await loadFeedXmlWithFallbacks(src.rss_url, src.homepage_url);

      if (!xml || !finalUrl) {
        errors.push({ source: srcName, error: error ?? "Unknown error" });
        stats.push({ source: srcName, added: 0, finalUrl: null, tried, discovered });
        continue;
      }

      // Persist discovered RSS (self-heal)
      if (discovered && discovered !== src.rss_url) {
        try {
          await query(`UPDATE sources SET rss_url = $1 WHERE name = $2`, [
            discovered,
            srcName,
          ]);
        } catch {
          /* non-fatal */
        }
      }

      // B) sanitize before parsing
      const cleaned = sanitizeXml(xml);
      const feed = await parser.parseString(cleaned);

      const items = (feed.items ?? []).slice(0, MAX_ITEMS_PER_FEED) as Itemish[];

      for (const item of items) {
        if (!item?.link) continue;

        const e = await enrich(srcName, item);

        const url = e?.url ?? item.link;
        const canonical_url = e?.canonical_url ?? url;
        const domain = e?.domain ?? null;

        const titleFromItem = safeSlice(item.title, 280);
        const cleaned_title = safeSlice(e?.cleaned_title, 280);
        const slug = safeSlice(e?.slug, 120);

        const fingerprint = e?.fingerprint ?? null;
        const published_at = e?.published_at ?? null;
        const week = e?.week ?? null;
        const topics = e?.topics ?? null;
        const image_url = e?.image_url ?? null;

        // Accept either unique constraint (url or canonical_url) without crashing
        const res = await query(
          `
          INSERT INTO articles(
            source_id, url, canonical_url, domain,
            title, cleaned_title, slug, fingerprint,
            published_at, discovered_at, sport, season, week, topics, image_url
          )
          VALUES (
            (SELECT id FROM sources WHERE name = $1),
            $2, $3, $4,
            $5, $6, $7, $8,
            $9::timestamptz,
            NOW(),
            'nfl',
            EXTRACT(YEAR FROM NOW())::int,
            $10,
            $11,
            $12
          )
          ON CONFLICT DO NOTHING
          RETURNING id
          `,
          [
            srcName,
            url,
            canonical_url,
            domain,
            titleFromItem,
            cleaned_title,
            slug,
            fingerprint,
            published_at,
            week,
            topics,
            image_url,
          ]
        );

        inserted += res.rows.length;
        addedForSource += res.rows.length;
      }

      stats.push({ source: srcName, added: addedForSource, finalUrl, tried, discovered });
    } catch (err: any) {
      const message = String(err?.message ?? err);
      errors.push({ source: srcName, error: message });
      stats.push({
        source: srcName,
        added: 0,
        finalUrl: null,
        tried: src.rss_url ? [src.rss_url] : [],
        discovered: null,
      });
      console.warn(`[ingest] ${srcName} failed: ${message}`);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, inserted, ...(debug ? { stats, errors } : {}) }, null, 2),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
