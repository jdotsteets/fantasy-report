import { XMLParser } from "fast-xml-parser";
import * as iconv from "iconv-lite";
import * as cheerio from "cheerio";

export type FeedItem = {
  title: string;
  link: string;
  publishedAt: string | null;
  description?: string | null;
};


// --- helpers (put near top of file) ---
function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function so(v: unknown): string | null {
  return v == null ? null : String(v);
}

type Rss2 = { rss?: { channel?: { item?: unknown | unknown[] } } };
type Atom = { feed?: { entry?: unknown | unknown[] } };
type Rdf1 = { RDF?: { item?: unknown | unknown[] }; rdf?: { item?: unknown | unknown[] } };



export type FeedFetchOpts = {
  url: string;
  userAgent?: string;
  timeoutMs?: number;
  // When true, drop urls that look premium/paywalled
  dropPremium?: boolean;
  // Extra denylist patterns (in addition to built-ins)
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

const PREMIUM_DENY = [
  /\/subscribe/i,
  /\/subscription/i,
  /\/premium/i,
  /\/insider/i,
  /\/edge\//i,
  /\/plus\//i,
  /paywall/i,
];

function dropPremium(url: string, extra?: RegExp[]) {
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

// ---- RSS/Atom normalizers

// --- replace your normalizeRss with this ---
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

// ---- Fallback HTML scraping
function parseListHtml(html: string, baseUrl: string): FeedItem[] {
  const $ = cheerio.load(html);
  const links: FeedItem[] = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") || "";
    const title = ($(el).text() || "").trim();
    if (!title || !href) return;
    if (title.length < 6) return;

    const link = new URL(href, baseUrl).toString();
    links.push({ title, link, publishedAt: null });
  });
  const seen = new Set<string>();
  return links.filter((x) => (seen.has(x.link) ? false : (seen.add(x.link), true))).slice(0, 50);
}

// ---- Main
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

    if (drop) {
      items = items.filter((it) => it.link && !dropPremium(it.link, denyPatterns));
    }

    return items.map((it) => ({
      ...it,
      link: (it.link || "").replace(/^<|>$/g, ""),
    }));
  } catch {
    const items = parseListHtml(text, url).filter(
      (it) => it.link && (!drop || !dropPremium(it.link, denyPatterns))
    );
    if (items.length === 0) throw new Error("No items found");
    return items;
  }
}
