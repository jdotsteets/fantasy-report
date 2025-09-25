// lib/site-extractors/fantasypros.ts
import type { Extractor, WaiverHit } from "./types";

function stripTags(s: string) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const extractFantasyPros: Extractor = (html, _u): WaiverHit[] => {
  if (!html) return [];
  const out: WaiverHit[] = [];
  const seen = new Set<string>();
  const push = (name: string, hint?: string, section?: string) => {
    const clean = (name || "").replace(/\s+/g, " ").trim();
    if (!clean || clean.split(/\s+/).length < 2) return;
    const pos = hint ? hint.toUpperCase() : undefined;
    const key = `${clean}|${pos ?? ""}|${section ?? ""}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: clean, hint: pos, section });
  };

  // A) Server-rendered table rows (rank cell -> name <a> -> POS cell)
  const rowRx = /<tr[^>]*>\s*<td[^>]*>\s*\d+\s*<\/td>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRx.exec(html)) !== null) {
    const row = rm[1];
    const nameMatch = row.match(/<a[^>]*>([^<]+)<\/a>/i);
    if (!nameMatch) continue;
    const posMatch =
      row.match(/<td[^>]*>\s*(QB|RB|WR|TE|K|DST)\s*\d*\s*<\/td>/i) ||
      row.match(/>(QB|RB|WR|TE|K|DST)\s*<\/(?:small|span|td)>/i);

    const name = nameMatch[1].trim();
    if (/^(overall|player\s*name)$/i.test(name)) continue;
    const pos = posMatch ? posMatch[1].toUpperCase() : undefined;
    push(name, pos, "table");
  }
  if (out.length) return out;

  // B) Client-rendered: embedded JS array
  const jsMatch = html.match(/var\s+ecrData\s*=\s*(\[[\s\S]*?\]);/i);
  if (jsMatch) {
    let jsonText = jsMatch[1]
      .replace(/\/\/[^\n]*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,\s*([\]\}])/g, "$1"); // trailing commas

    try {
      const arr = JSON.parse(jsonText) as Array<any>;
      for (const row of arr) {
        const name: string | undefined = row?.player_name || row?.player || row?.name;
        const pos: string | undefined = (row?.pos || row?.position || row?.POS || "").toString();
        if (name) push(name, pos, "ecrData");
      }
    } catch {
      /* swallow and fall through */
    }
  }
  if (out.length) return out;

  // C) Text fallback
  const text = stripTags(html);
  const cardRx = /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\s+(QB|RB|WR|TE|K|DST)\b/g;
  let tm: RegExpExecArray | null;
  while ((tm = cardRx.exec(text)) !== null) {
    push(tm[1], tm[2], "text");
  }
  return out;
};
