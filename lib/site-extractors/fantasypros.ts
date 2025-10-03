import type { Extractor, WaiverHit, Pos } from "./types";

/* ───────────────────────── Utils ───────────────────────── */

function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;/g, " ")
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/* ───────────────────────── Extractor ───────────────────────── */

export const extractFantasyPros: Extractor = (html, _url): WaiverHit[] => {
  if (!html) return [];
  const out: WaiverHit[] = [];
  const seen = new Set<string>();

  const push = (name: string, posStr?: string, hint?: string, section?: string) => {
    const clean = (name || "").replace(/\s+/g, " ").trim();
    if (!clean || clean.split(/\s+/).length < 2) return;
    const pos = normPos(posStr);
    const key = `${clean}|${pos ?? ""}|${hint ?? ""}|${section ?? ""}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: clean, pos, hint, section });
  };

  // A) Server-rendered table rows (rank -> <a>name</a> -> POS cell)
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

    push(name, posMatch ? posMatch[1] : undefined, "table");
  }
  if (out.length) return out;

  // B) Client-rendered: embedded JS array like: var ecrData = [ ... ];
  const jsMatch = html.match(/var\s+ecrData\s*=\s*(\[[\s\S]*?\]);/i);
  if (jsMatch) {
    const jsonText = jsMatch[1]
      .replace(/\/\/[^\n]*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,\s*([\]\}])/g, "$1"); // remove trailing commas

    try {
      const arr = JSON.parse(jsonText) as unknown;
      if (Array.isArray(arr)) {
        for (const v of arr) {
          if (!isRecord(v)) continue;
          const name =
            (typeof v.player_name === "string" && v.player_name) ||
            (typeof v.player === "string" && v.player) ||
            (typeof v.name === "string" && v.name) ||
            undefined;

          const posRaw =
            (typeof v.pos === "string" && v.pos) ||
            (typeof v.position === "string" && v.position) ||
            (typeof v.POS === "string" && v.POS) ||
            undefined;

          if (name) push(name, posRaw, "ecrData");
        }
      }
    } catch {
      /* swallow and fall through */
    }
  }
  if (out.length) return out;

  // C) Text fallback sweep
  const text = stripTags(html);
  const cardRx = /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\s+(QB|RB|WR|TE|K|DST)\b/g;
  let tm: RegExpExecArray | null;
  while ((tm = cardRx.exec(text)) !== null) {
    push(tm[1], tm[2], "text");
  }

  return out;
};
