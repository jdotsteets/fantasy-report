// lib/enrichers/cbs.ts
import * as cheerio from "cheerio";

export async function fixCbsFantasyTitle(
  url: string,
  currentTitle?: string | null
): Promise<string | null> {
  const u = url || "";
  const looksCbsFantasy =
    /(^|\.)cbssports\.com$/i.test(new URL(u).hostname) &&
    /\/fantasy\/football\/news\//i.test(u);

  const bad =
    !currentTitle ||
    /^\s*see\s+full\s+article\s*$/i.test(currentTitle) ||
    /^\s*read\s+more\s*$/i.test(currentTitle);

  if (!looksCbsFantasy && !bad) return null;

  try {
    const res = await fetch(u, { redirect: "follow" });
    const html = await res.text();
    const $ = cheerio.load(html);

    // 1) og:title / twitter:title
    const og = $('meta[property="og:title"]').attr("content");
    if (og && !/see full article/i.test(og)) return og.trim();

    const tw = $('meta[name="twitter:title"]').attr("content");
    if (tw && !/see full article/i.test(tw)) return tw.trim();

    // 2) JSON-LD NewsArticle.headline
    const ld = $('script[type="application/ld+json"]')
      .toArray()
      .map((el) => {
        try {
          return JSON.parse($(el).text());
        } catch {
          return null;
        }
      })
      .filter(Boolean) as any[];

    for (const blob of ld) {
      const nodes = Array.isArray(blob) ? blob : [blob];
      for (const n of nodes) {
        const t = (n?.headline || n?.name) as string | undefined;
        if (t && !/see full article/i.test(t)) return t.trim();
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
      .replace(/\b([a-z])([a-z]+)/g, (_, a, b) => a.toUpperCase() + b) // title-case-ish
      .replace(/\bNfl\b/g, "NFL");
    return words.length ? words : null;
  } catch {
    return null;
  }
}
