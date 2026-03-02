// lib/feeds.ts
import { XMLParser } from "fast-xml-parser";
import * as iconv from "iconv-lite";
import * as cheerio from "cheerio";

export type FeedItem = {
  title: string;
  link: string;
  publishedAt: string | null;
  description?: string | null;
};

// ─── helpers ────────────────────────────────────────────────────────────────
function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function so(v: unknown): string | null {
  return v == null ? null : String(v);
}

type Rss2 = { rss?: { channel?: { item?: unknown | unknown[] } } };
type Atom = { feed?: { entry?: unknown | unknown[] } };
type Rdf1 = { RDF?: { item?: unknown | unknown[] }; rdf?: { item?: unknown | unknown[] } };

const BAD_SCHEMES = /^(javascript:|mailto:|tel:)/i;
const SOCIAL_OR_CORP: ReadonlyArray<RegExp> = [
  /twitter\.com/i, /x\.com/i, /facebook\.com/i, /instagram\.com/i, /youtube\.com/i,
  /about/i, /privacy/i, /terms/i, /subscribe/i, /login/i, /signin/i, /signup/i,
  /affiliate/i, /advertis/i, /gift/i,
];

const ALLOW_BY_DOMAIN: Record<string, RegExp[]> = {
  "fantasypros.com": [
    /^https?:\/\/(www\.)?fantasypros\.com\/nfl\/(news|rankings|start-sit|waiver-wire|dfs|advice)\/?/i,
    /^https?:\/\/(www\.)?fantasypros\.com\/nfl\/[\w-]+\/?$/i,
  ],
  "pff.com": [/^https?:\/\/(www\.)?pff\.com\/news\//i],
};

function allowedByDomain(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "");
    const allow = ALLOW_BY_DOMAIN[host];
    if (!allow) return true; // default permissive
    return allow.some((re) => re.test(url));
  } catch {
    return false;
  }
}

export type FeedFetchOpts = {
  url: string;
  userAgent?: string;
  timeoutMs?: number;
  dropPremium?: boolean;
  denyPatterns?: RegExp[];
};

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const parser = new XMLParser({
  ignoreAttributes: false,
  allowBooleanAttributes: true,
  processEntities: true,
  preserveOrder: false,
  parseTagValue: true,
  trimValues: true,
});

const PREMIUM_DENY: ReadonlyArray<RegExp> = [
  /\/subscribe/i,
  /\/subscription/i,
  /\/premium/i,
  /\/insider/i,
  /\/edge\//i,
  /\/plus\//i,
  /paywall/i,
];

function dropPremium(url: string, extra?: ReadonlyArray<RegExp>) {
  return [...PREMIUM_DENY, ...(extra ?? [])].some((re) => re.test(url));
}

async function fetchBuffer(url: string, timeoutMs = 12000, userAgent = DEFAULT_UA) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": userAgent, accept: "*/*" },
      redirect: "follow",
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ctype = res.headers.get("content-type") || "";
    return { buf, ctype };
  } finally {
    clearTimeout(t);
  }
}

function decode(buf: Buffer, ctype: string) {
  const m = /charset=([^;]+)/i.exec(ctype);
  const charset = (m?.[1] || "utf-8").toLowerCase();
  if (charset === "utf-8" || charset === "utf8") return buf.toString("utf8");
  if (iconv.encodingExists(charset)) return iconv.decode(buf, charset);
  return buf.toString("utf8");
}

// ─── RSS/Atom normalizers ───────────────────────────────────────────────────
function normalizeRss(rss: unknown): FeedItem[] {
  const r = rss as Rss2 & Atom & Rdf1;

  // RSS 2.0
  if (r.rss && typeof r.rss === "object" && r.rss.channel?.item !== undefined) {
    const chan = r.rss.channel!;
    const items = Array.isArray(chan.item) ? chan.item : [chan.item];
    return (items as unknown[]).map((it): FeedItem => {
      const o = it as Record<string, unknown>;
      return {
        title: s(o.title),
        link: s(o.link ?? o.guid),
        publishedAt: so(o.pubDate ?? (o as Record<string, unknown>)["dc:date"]),
        description: so(o.description),
      };
    });
  }

  // Atom
  if (r.feed && typeof r.feed === "object" && r.feed.entry !== undefined) {
    const feed = r.feed!;
    const items = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
    return (items as unknown[]).map((it): FeedItem => {
      const o = it as Record<string, unknown>;

      // title can be a string or { "#text": string }
      let title = "";
      const t = o.title;
      if (typeof t === "string") title = t;
      else if (t && typeof t === "object" && "#text" in (t as Record<string, unknown>)) {
        title = s((t as Record<string, unknown>)["#text"]);
      } else title = s(t);

      // link can be array of link objects or a single link object/string
      let link = "";
      const lk = o.link;
      if (Array.isArray(lk)) {
        const alt = lk.find((l) => (l as Record<string, unknown>)?.["@_rel"] === "alternate");
        const altObj = alt as Record<string, unknown> | undefined;
        link = s(altObj?.["@_href"] ?? altObj?.href ?? alt);
      } else if (lk && typeof lk === "object") {
        const lo = lk as Record<string, unknown>;
        link = s(lo["@_href"] ?? lo.href ?? lk);
      } else {
        link = s(lk);
      }

      return {
        title,
        link,
        publishedAt: so(o.published ?? o.updated),
        description: so(o.summary ?? o.content),
      };
    });
  }

  // RSS 1.0 (RDF)
  if ((r.RDF && r.RDF.item !== undefined) || (r.rdf && r.rdf.item !== undefined)) {
    const items = (r.RDF?.item ?? r.rdf?.item) as unknown | unknown[];
    const arr = Array.isArray(items) ? items : [items];
    return (arr as unknown[]).map((it): FeedItem => {
      const o = it as Record<string, unknown>;
      return {
        title: s(o.title),
        link: s(o.link),
        publishedAt: so((o as Record<string, unknown>)["dc:date"]),
        description: so(o.description),
      };
    });
  }

  throw new Error("Feed not recognized as RSS or Atom");
}

// ─── Fallback HTML list scraping ────────────────────────────────────────────
function parseListHtml(html: string, baseUrl: string): FeedItem[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const sameHost = base.hostname.replace(/^www\./i, "");

  const BANNED_SLUGS = new Set([
    "about","company","contact","accessibility","privacy","terms",
    "do_not_sell_modal","ccpa","cookie","contribute","advertise",
    "affiliate","gift-cards","plans","pricing","accounts",
    "signin","sign-in","login","signup","sign-up","mobile","apps",
  ]);

  const out: FeedItem[] = [];
  $("a[href]").each((_i, el) => {
    const rawHref = ($(el).attr("href") || "").trim();
    const title = ($(el).text() || "").trim();
    if (!rawHref || !title || title.length < 6) return;
    if (BAD_SCHEMES.test(rawHref)) return;

    let u: URL;
    try {
      u = new URL(rawHref, base);
    } catch {
      return;
    }

    const host = u.hostname.replace(/^www\./i, "");
    if (host !== sameHost) return;

    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return;
    if (parts.some((p) => BANNED_SLUGS.has(p))) return;

    out.push({ title, link: u.toString(), publishedAt: null });
  });

  // de-dupe by absolute URL
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.link) ? false : (seen.add(x.link), true))).slice(0, 100);
}

// ─── Main fetch ─────────────────────────────────────────────────────────────
export async function fetchFeed(opts: FeedFetchOpts): Promise<FeedItem[]> {
  const {
    url,
    userAgent = DEFAULT_UA,
    timeoutMs = 12000,
    dropPremium: drop = true,
    denyPatterns,
  } = opts;

  const { buf, ctype } = await fetchBuffer(url, timeoutMs, userAgent);
  const text = decode(buf, ctype);

  try {
    const data = parser.parse(text);
    let items = normalizeRss(data);

    // normalize and filter
    items = items
      .map((it) => ({ ...it, link: (it.link || "").trim() }))
      .filter((it) => it.title && it.link && /^https?:\/\//i.test(it.link))
      .filter((it) => !BAD_SCHEMES.test(it.link))
      .filter((it) => !drop || !dropPremium(it.link, denyPatterns))
      .filter((it) => SOCIAL_OR_CORP.every((re) => !re.test(it.link)))
      .filter((it) => allowedByDomain(it.link));

    // final cleanup of angle-bracketed links
    return items.map((it) => ({ ...it, link: it.link.replace(/^<|>$/g, "") }));
  } catch {
    // Not valid XML? Fall back to basic list scraping.
    const items = parseListHtml(text, url).filter(
      (it) => it.link && (!drop || !dropPremium(it.link, denyPatterns))
    );
    if (items.length === 0) throw new Error("No items found");
    return items;
  }
}
