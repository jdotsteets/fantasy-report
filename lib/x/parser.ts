// lib/x/parser.ts
export type ParsedItem = {
  player: string;
  position?: string;
  rank: number;
  overall: boolean;
};

const POS = ["QB","RB","WR","TE","K","DST","DEF","FLEX","SUPERFLEX"] as const;
const POS_SET = new Set(POS);

const CLEAN = [
  /[#@][\w_]+/g,       // hashtags, mentions
  /https?:\/\/\S+/g,   // links
  /[\u{1F300}-\u{1FAFF}]/gu, // emojis
];

function normalize(text: string): string {
  let t = text;
  for (const re of CLEAN) t = t.replace(re, "");
  return t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

function lineTokens(text: string): string[] {
  return normalize(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function detectPositionHint(text: string): string | undefined {
  const low = text.toLowerCase();
  for (const p of POS) {
    const needle = p.toLowerCase();
    if (low.includes(` ${needle}`) || low.includes(`${needle}s`)) return p;
  }
  if (/\boverall\b/i.test(text)) return "OVERALL";
  return undefined;
}

/** Parse lines like:
 *  - "1) Christian McCaffrey"
 *  - "1. Justin Jefferson"
 *  - "1 - Breece Hall"
 *  - "Top 10 WRs: Amon-Ra, Lamb, Hill, ... "
 */
export function parseRankingList(text: string): ParsedItem[] {
  const lines = lineTokens(text);
  const items: ParsedItem[] = [];

  // Case A: a single-line "Top N ..." with comma-separated names
  const topLine = lines.find((l) => /\btop\s*\d+\b/i.test(l));
  if (topLine) {
    const posHint = detectPositionHint(topLine);
    const m = topLine.match(/:\s*(.+)$/);
    if (m && m[1]) {
      const names = m[1].split(/[;,]/).map((s) => s.trim()).filter(Boolean);
      names.forEach((name, i) => {
        items.push({
          player: name,
          position: posHint && posHint !== "OVERALL" ? posHint : undefined,
          rank: i + 1,
          overall: posHint === "OVERALL" || !posHint,
        });
      });
      if (items.length > 0) return items;
    }
  }

  // Case B: numbered lines
  let saw = 0;
  for (const l of lines) {
    const m = l.match(/^\s*(\d{1,2})[)\.\-]?\s+(.+?)\s*$/);
    if (m) {
      const rank = Number(m[1]);
      const name = m[2].replace(/\s*-\s*(WR|RB|QB|TE|K|DST|DEF)\s*$/i, "").trim();
      const posMatch = l.match(/\b(WR|RB|QB|TE|K|DST|DEF|FLEX|SUPERFLEX)\b/i);
      const pos = posMatch ? posMatch[1].toUpperCase() : undefined;
      items.push({
        player: name,
        position: pos && POS_SET.has(pos as typeof POS[number]) ? pos.toUpperCase() : undefined,
        rank,
        overall: !pos || pos.toUpperCase() === "OVERALL",
      });
      saw++;
    }
  }
  if (saw > 0) return items;

  // Case C: "must-have" lists: take first 3-10 names separated by commas
  if (/\bmust[- ]?have\b/i.test(text) || /\bmy (?:five|top\s*\d+)\b/i.test(text)) {
    const names = normalize(text)
      .split(/\b(?:must[- ]?have|my(?:\s*top)?\s*\d+)\b/i)
      .pop()
      ?.split(/[;,]/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z .'\-]{3,}$/.test(s))
      .slice(0, 15) ?? [];
    return names.map((n, i) => ({ player: n, rank: i + 1, overall: true }));
  }

  return [];
}

/** Reverse-points scoring: if list has N players, #1 gets N, #2 gets N-1, ... */
export function scoreItems(items: ParsedItem[]): ParsedItem[] {
  const _n = items.length;
  return items.map((it) => ({
    ...it,
    // points filled by caller — we keep rank only here
  }));
}
