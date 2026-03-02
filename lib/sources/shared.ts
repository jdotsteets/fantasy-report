// lib/sources/shared.ts
import * as cheerio from "cheerio";

/** Minimal, typed config for HTTP + parsing utilities. */
export type HttpCfg = {
  headers?: Record<string, string>;
  timeoutMs?: number;       // request timeout (ms)
  retries?: number;         // how many extra tries on 429/5xx
  retryBaseMs?: number;     // base backoff in ms
};

/** Fetch HTML with redirects, timeout, and light retries (uses global fetch). */
export async function httpGet(url: string, cfg?: HttpCfg): Promise<string> {
  const retries = Math.max(0, cfg?.retries ?? 2);
  const base = Math.max(1, cfg?.retryBaseMs ?? 250);
  const timeout = Math.max(1, cfg?.timeoutMs ?? 15000);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": "FantasyReportBot/1.0 (+https://fantasy-report.app)",
          "accept": "text/html,application/xhtml+xml",
          ...(cfg?.headers ?? {}),
        },
        signal: ac.signal,
      });

      if (res.ok) {
        clearTimeout(t);
        return await res.text();
      }

      // retry on transient statuses
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries) {
        clearTimeout(t);
        const delay = base * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      clearTimeout(t);
      throw new Error(`HTTP ${res.status} ${url}`);
    } catch (err) {
      clearTimeout(t);
      // retry on abort or network errors, if we have attempts left
      if (attempt < retries) {
        const delay = base * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  // should never reach here
  throw new Error(`HTTP retry_exhausted ${url}`);
}

/** Thin wrapper for Cheerio HTML parser. */
export function parseHtml(html: string) {
  // no unsupported options; defaults are fine for HTML
  return cheerio.load(html);
}

/** Make a relative URL absolute with a base. */
export function absolutize(href: string, base: string): string {
  return new URL(href, base).toString();
}

/** Canonicalize URLs: strip hash + UTM* params. */
export function normalizeUrl(u: string): string {
  const url = new URL(u);
  url.hash = "";
  for (const k of Array.from(url.searchParams.keys())) {
    if (k.toLowerCase().startsWith("utm_")) url.searchParams.delete(k);
  }
  return url.toString();
}

/** Deduplicate by a stable key. */
export function dedupe<T, K extends string | number>(arr: T[], by: (t: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const x of arr) {
    const k = by(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
