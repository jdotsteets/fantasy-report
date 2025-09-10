// lib/enrichers/cbs.ts
import * as cheerio from "cheerio";

function safeHostname(href: string): string | null {
  try {
    return new URL(href).hostname;
  } catch {
    return null;
  }
}

function hasGoodTitle(t?: string | null): t is string {
  return !!t && !/^\s*(see\s+full\s+article|read\s+more)\s*$/i.test(t);
}

function isSeeFullArticle(t: string): boolean {
  return /see full article/i.test(t);
}

function extractHeadlineLike(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const rec = node as Record<string, unknown>;
  const h = rec.headline;
  const n = rec.name;
  if (typeof h === "string" && !isSeeFullArticle(h)) return h.trim();
  if (typeof n === "string" && !isSeeFullArticle(n)) return n.trim();
  return null;
}

export async function fixCbsFantasyTitle(
  url: string,
  currentTitle?: string | null
): Promise<string | null> {
  const u = url || "";
  const host = safeHostname(u);

  const looksCbsFantasy =
    !!host && /(^|\.)cbssports\.com$/i.test(host) && /\/fantasy\/football\/news\//i.test(u);

  const bad = !hasGoodTitle(currentTitle);

  // If it's not a CBS Fantasy News URL and the current title is fine, do nothing.
  if (!looksCbsFantasy && !bad) return null;

  try {
    const res = await fetch(u, { redirect: "follow" });
    const html = await res.text();
    const $ = cheerio.load(html);

    // 1) og:title / twitter:title
    const og = $('meta[property="og:title"]').attr("content");
    if (og && !isSeeFullArticle(og)) return og.trim();

    const tw = $('meta[name="twitter:title"]').attr("content");
    if (tw && !isSeeFullArticle(tw)) return tw.trim();

    // 2) JSON-LD NewsArticle.headline (or .name)
    const ldBlobs: unknown[] = $('script[type="application/ld+json"]')
      .toArray()
      .map((el) => {
        try {
          return JSON.parse($(el).text());
        } catch {
          return null;
        }
      })
      .filter((v): v is unknown => v != null);

    for (const blob of ldBlobs) {
      const nodes = Array.isArray(blob) ? (blob as unknown[]) : [blob];
      for (const n of nodes) {
        const t = extractHeadlineLike(n);
        if (t) return t;
      }
    }
  } catch {
    /* network best-effort */
  }

  // 3) Last-resort: derive from slug
  try {
    const slug = new URL(u).pathname.split("/").filter(Boolean).pop() || "";
    const words = slug
      .replace(/[-_]+/g, " ")
      .replace(/\b([a-z])([a-z]+)/g, (_m, a: string, b: string) => a.toUpperCase() + b) // title-case-ish
      .replace(/\bNfl\b/g, "NFL")
      .trim();
    return words.length ? words : null;
  } catch {
    return null;
  }
}
