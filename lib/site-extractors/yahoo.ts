// lib/site-extractors/yahoo.ts
import type { Extractor, WaiverHit, Pos } from "./types";

/* ───────────── Utils ───────────── */

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&mdash;|&ndash;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normPos(raw?: string): Pos | undefined {
  if (!raw) return undefined;
  const up = raw.toUpperCase().replace(/\s+/g, "");
  if (up === "D/ST" || up === "DST" || up === "DEF" || up === "DEFENSE") return "DST";
  if (up === "QB" || up === "RB" || up === "WR" || up === "TE" || up === "K") return up;
  return undefined;
}

const TEAM_NAMES = new Set<string>([
  "arizona cardinals","atlanta falcons","baltimore ravens","buffalo bills","carolina panthers",
  "chicago bears","cincinnati bengals","cleveland browns","dallas cowboys","denver broncos",
  "detroit lions","green bay packers","houston texans","indianapolis colts","jacksonville jaguars",
  "kansas city chiefs","las vegas raiders","los angeles chargers","los angeles rams","miami dolphins",
  "minnesota vikings","new england patriots","new orleans saints","new york giants","new york jets",
  "philadelphia eagles","pittsburgh steelers","san francisco 49ers","seattle seahawks",
  "tampa bay buccaneers","tennessee titans","washington commanders"
]);
function isTeamName(name: string): boolean {
  return TEAM_NAMES.has(name.toLowerCase());
}

function pushUnique(out: WaiverHit[], seen: Set<string>, hit: WaiverHit) {
  const cleanName = (hit.name || "").replace(/\s+/g, " ").trim();
  if (!cleanName || cleanName.split(/\s+/).length < 2) return;

  // filter out pure team names unless clearly DST context
  if (isTeamName(cleanName) && hit.pos !== "DST") {
    const ctx = `${hit.hint ?? ""} ${hit.section ?? ""}`.toLowerCase();
    if (!/(def|dst|d\/st|defense|special teams)/.test(ctx)) return;
  }

  const key = `${cleanName}|${hit.pos ?? ""}|${hit.hint ?? ""}|${hit.section ?? ""}`.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ ...hit, name: cleanName });
}

function textBetweenHeadings(html: string, startIdx: number): string {
  const after = html.slice(startIdx);
  const next = after.match(/<(?:h2|h3|h4)[^>]*>[\s\S]*?<\/(?:h2|h3|h4)>/i);
  const end = next ? (next.index ?? 0) : after.length;
  return after.slice(0, end);
}

function hasDeepStashWording(s: string): boolean {
  return /(deep\s*stash|deep-?stashes|stash(?:es)?\s*(?:for|to|candidates|targets)|deep\s*league\s*stash)/i.test(s);
}
function getTitleLike(html: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? "";
  return (og || t || "").replace(/\s+/g, " ").trim();
}
function splitNamesCommaList(s: string): string[] {
  return s
    .split(/,|(?:\s+and\s+)/i)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2}$/.test(x));
}

/* ───────────── Extractor ───────────── */

export const extractYahoo: Extractor = (html, url): WaiverHit[] => {
  if (!html) return [];
  // accept both /fantasy/* and /article/*
  if (!/sports\.yahoo\.com\/(?:fantasy|article)\b/i.test(url.href)) return [];

  // article-level deep-stash theme
  const title = getTitleLike(html);
  const h1 = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const articleIsDeep = hasDeepStashWording(url.pathname) || hasDeepStashWording(title) || hasDeepStashWording(h1);

  const out: WaiverHit[] = [];
  const seen = new Set<string>();
  const push = (name: string, pos?: string, hint?: string, section?: string) =>
    pushUnique(out, seen, { name, pos: normPos(pos), hint, section });

  // A) strong/b/em blocks — NOW capture inner HTML and strip tags (fixes <strong><a>NAME</a></strong>)
  const strongRx = /<(?:strong|b|em)[^>]*>([\s\S]*?)<\/(?:strong|b|em)>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = strongRx.exec(html)) !== null) {
    const raw = stripTags(sm[1]).replace(/\s+/g, " ").trim();
    const m =
      raw.match(/^([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,2})(?:,\s*[A-Z]{2,4})?\s*[—-]\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*/i) ||
      raw.match(/^([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,2})\s*\(\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*[^)]*\)$/i) ||
      raw.match(/^([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,2})\s*,\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*/i);
    if (m) push(m[1], m[2], "strong");
  }
  if (out.length) {
    if (articleIsDeep) for (const h of out) if (!h.section) h.section = "Deep Stashes";
    return out;
  }

  // B) headings — include h4 and allow trailing ":" after POS
  const headingRx = /<(h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRx.exec(html)) !== null) {
    const headingText = stripTags(hm[2]);

    const sectionLabel =
      /honou?rable mentions?:?/i.test(headingText) ? "Honorable Mentions" :
      /deep\s*stash(?:es)?:?/i.test(headingText) ? "Deep Stashes" :
      undefined;

    if (sectionLabel) {
      const block = textBetweenHeadings(html, hm.index + hm[0].length);

      // 1) list items
      const liRx = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let lm: RegExpExecArray | null;
      let found = false;
      while ((lm = liRx.exec(block)) !== null) {
        const t = stripTags(lm[1]);
        const m =
          t.match(/^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})(?:\s*[—-]\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF))?/i) ||
          t.match(/^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\s*\(\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b/i);
        if (m) {
          push(m[1], m[2], "list", sectionLabel);
          found = true;
        } else {
          for (const nm of splitNamesCommaList(t)) {
            push(nm, undefined, "list", sectionLabel);
            found = true;
          }
        }
      }

      // 2) inline HM label within this block
      const inlineHmRx = /<(?:strong|b)[^>]*>\s*honou?rable mentions?:\s*<\/(?:strong|b)>([\s\S]*?)<\/p>/i;
      const inline = inlineHmRx.exec(block)?.[1] ?? "";
      if (inline) {
        const t = stripTags(inline);
        for (const nm of splitNamesCommaList(t)) push(nm, undefined, "inline", sectionLabel);
        found = true;
      }

      // 3) bold fallback
      if (!found) {
        const boldRx = /<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi;
        let bm: RegExpExecArray | null;
        while ((bm = boldRx.exec(block)) !== null) {
          const rawB = stripTags(bm[1]).replace(/\s+/g, " ").trim();
          const m =
            rawB.match(/^([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,2})(?:,\s*[A-Z]{2,4})?\s*[—-]\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*/i) ||
            rawB.match(/^([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,2})\s*\(\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*[^)]*\)$/i) ||
            rawB.match(/^([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,2})\s*,\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*/i);
          if (m) push(m[1], m[2], "bold", sectionLabel);
        }
      }
      continue;
    }

    // regular player heading
    const m =
      headingText.match(/^([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,2})(?:,\s*[A-Z]{2,4})?\s*[—-]\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*/i) ||
      headingText.match(/^([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,2})\s*\(\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*[^)]*\)$/i) ||
      headingText.match(/^([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,2})\s*,\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*/i);
    if (m) push(m[1], m[2], "heading");
  }

  // C) anchor-nearby scan — <a>Player Name</a> ... POS  (within ~120 chars)
  if (!out.length) {
    const anchorBlockRx = /<a[^>]*>([^<]+)<\/a>([\s\S]{0,120}?\b(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*)/gi;
    let am: RegExpExecArray | null;
    while ((am = anchorBlockRx.exec(html)) !== null) {
      const name = (am[1] || "").replace(/\s+/g, " ").trim();
      const pos = am[3];
      // keep it strict: name should look like a human name (2–3 tokens)
      if (/^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2}$/.test(name)) {
        push(name, pos, "anchor");
      }
    }
  }

  // default Deep Stashes section if themed
  if (articleIsDeep) for (const h of out) if (!h.section) h.section = "Deep Stashes";
  if (out.length) return out;

  // D) final text sweep (requires explicit POS near name)
  const text = stripTags(html);
  const textRx = /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})(?:,\s*[A-Z]{2,4})?\s*(?:[—-]|\(|,|\s)\s*(QB|RB|WR|TE|K|D\/ST|DST|DEF)\b:?\s*/g;
  let tm: RegExpExecArray | null;
  while ((tm = textRx.exec(text)) !== null) {
    push(tm[1], tm[2], "text");
  }

  if (articleIsDeep) for (const h of out) if (!h.section) h.section = "Deep Stashes";
  return out;
};
