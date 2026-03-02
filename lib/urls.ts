// lib/urls.ts
const TRACKING_PARAMS = new Set([
  // common
  "utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_name",
  "utm_cid","utm_reader","utm_referrer","utm_social","utm_social-type",
  "gclid","fbclid","mc_cid","mc_eid","igshid","vero_conv","vero_id","_hsenc","_hsmi",
  "spm","sr","ref","ref_src","cmp","cmpid","cmpid2","camp","campaign","eid","mibextid",
  // RSS-ish
  "src","guce_referrer","guce_referrer_sig","guccounter",
]);

const REDIRECT_PARAM_KEYS = [
  "url","u","to","dest","destination","redirect","r","rd","redir","link","target","go",
  "out","next","continue","ref","referrer",
] as const;

/** Unwrap one “redirect” hop if URL looks like a redirector (Facebook, Yahoo, etc.). */
export function unwrapOnce(href: string): string | null {
  try {
    const u = new URL(href);

    // obvious hosts
    const h = u.hostname.toLowerCase();
    const isKnown =
      h.startsWith("l.facebook.com") ||
      h.includes("out.reddit") ||
      h.includes("news.google") ||
      h.includes("flip.it") ||
      h.includes("apple.news") ||
      h.includes("r.zemanta") ||
      h.includes("t.co") ||
      h.includes("lnkd.in") ||
      h.includes("bit.ly") ||
      h.includes("tinyurl.com") ||
      h.includes("yhoo.it") ||
      h.includes("news.ycombinator.com") ||
      h.includes("feedproxy.google.com");

    // try common query keys
    for (const k of REDIRECT_PARAM_KEYS) {
      const v = u.searchParams.get(k);
      if (v) {
        try {
          return new URL(v, u).toString();
        } catch { /* ignore */ }
      }
    }

    // some redirectors encode the target in the path
    if (isKnown) {
      const m = decodeURIComponent(u.pathname).match(/https?:\/\/[^]+$/);
      if (m) return m[0];
    }
  } catch { /* ignore */ }
  return null;
}

/** Follow unwrapOnce repeatedly until it no longer changes. */
export function unwrapFully(href: string, maxHops = 4): string {
  let cur = href;
  for (let i = 0; i < maxHops; i++) {
    const next = unwrapOnce(cur);
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
}

function stripTracking(u: URL) {
  // remove fragments & tracking params
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
  }
}

/** Normalize a URL for stable storage & matching (scheme/host casing, tracking, slashes). */
export function normalizeUrl(input: string): string {
  // unwrap redirect chains first
  const unwrapped = unwrapFully(input);

  let u: URL;
  try {
    u = new URL(unwrapped);
  } catch {
    return input.trim();
  }

  // lower-case scheme/host
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();

  // collapse multiple slashes in path (but keep leading “/”)
  u.pathname = u.pathname.replace(/\/{2,}/g, "/");

  // drop default ports
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }

  // strip tracking bits
  stripTracking(u);

  // trim trailing slash on non-root paths, keep single slash for root
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }

  // sort query params for stability
  if ([...u.searchParams.keys()].length) {
    const sorted = new URLSearchParams();
    [...u.searchParams.keys()].sort().forEach(k => {
      const vals = u.searchParams.getAll(k);
      vals.forEach(v => sorted.append(k, v));
    });
    u.search = sorted.toString() ? `?${sorted.toString()}` : "";
  }

  return u.toString();
}
