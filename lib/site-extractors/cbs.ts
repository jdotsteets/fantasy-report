// lib/site-extractors/cbs.ts
import type { Extractor, WaiverHit } from "./types";

/** Remove UI labels and sentence tails; trim trailing POS token */
function stripUiLabels(s: string) {
  if (!s) return s;

  let t = s
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // If a sentence precedes the name, keep only the last fragment
  const parts = t.split(/[.!?]\s*/);
  if (parts.length > 1) t = parts[parts.length - 1]!.trim();

  // Remove leading UI labels (Priority List / FAB / List) with optional punctuation
  t = t.replace(/^(?:priority\s*list|fab\.?|list)\s*[:.\-–—]?\s*/i, "").trim();

  // Drop any trailing comma tail
  t = t.split(",")[0]!.trim();

  // Remove a trailing standalone POS token (and anything after it)
  t = t.replace(/\s+(?:QB|RB|WR|TE|K|DST)\b.*$/i, "").trim();

  return t;
}

/** Very light HTML → text */
function cleanTags(s: string) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export const extractCBSWaivers: Extractor = (html, _u): WaiverHit[] => {
  if (!html) return [];

  const out: WaiverHit[] = [];
  const seen = new Set<string>();

  // lines we should ignore entirely if they end up as "names"
  const IGNORE = /^(?:opp vs|matchup|weekly breakdown|ytd stats|rostered|age|experience|dst streamers|kicker streamers)$/i;

  const push = (rawName: string, hint?: string, section?: string) => {
    const name = stripUiLabels(rawName);
    if (!name || IGNORE.test(name)) return;

    // require at least two tokens for a person name
    const tokCount = (name.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
    if (tokCount < 2) return;

    const key = `${name}|${hint || ""}|${section || ""}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    out.push({ name, hint, section });
  };

  // ---------- 1) true “list after heading” blocks (kept just in case)
  const POS_HEADINGS: Array<{ rx: RegExp; hint: string; section: string }> = [
    { rx: /<h[23][^>]*>\s*quarterbacks?\b[\s\S]*?<\/h[23]>/i,                     hint: "QB",  section: "Quarterbacks" },
    { rx: /<h[23][^>]*>\s*running backs?\b[\s\S]*?<\/h[23]>/i,                   hint: "RB",  section: "Running Backs" },
    { rx: /<h[23][^>]*>\s*wide receivers?\b[\s\S]*?<\/h[23]>/i,                  hint: "WR",  section: "Wide Receivers" },
    { rx: /<h[23][^>]*>\s*tight ends?\b[\s\S]*?<\/h[23]>/i,                       hint: "TE",  section: "Tight Ends" },
    { rx: /<h[23][^>]*>\s*kickers?\b[\s\S]*?<\/h[23]>/i,                          hint: "K",   section: "Kickers" },
    { rx: /<h[23][^>]*>\s*(?:dst|defenses?|team defenses?)\b[\s\S]*?<\/h[23]>/i,  hint: "DST", section: "DST" },
  ];

  const grabListAfterHeading = (headingRx: RegExp, hint: string, section: string) => {
    const m = html.match(headingRx);
    if (!m) return;
    const after = html.slice((m.index ?? 0) + m[0].length);
    const ulMatch = after.match(/<ul[^>]*>[\s\S]*?<\/ul>/i);
    if (!ulMatch) return;
    const liMatches = ulMatch[0].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
    for (const li of liMatches) {
      const aMatch = li.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
      const candidate = cleanTags(aMatch ? aMatch[1] : li);
      const name = candidate.split(/[,–—-]/)[0].trim();
      push(name, hint, section);
    }
  };

  for (const { rx, hint, section } of POS_HEADINGS) grabListAfterHeading(rx, hint, section);

  // ---------- 2) strong/bold paragraph leads
  const strongLeadRx = /<(?:p|h3)[^>]*>\s*(?:<strong>|<b>)([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})<\/(?:strong|b)>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = strongLeadRx.exec(html)) !== null) {
    push(cleanTags(sm[1]), undefined, "lead");
  }

  const h3LeadRx = /<h3[^>]*>\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})(?:\s*[—:-]\s*|<\/h3>)/gi;
  while ((sm = h3LeadRx.exec(html)) !== null) {
    push(cleanTags(sm[1]), undefined, "lead");
  }

  // ---------- 3) Card blocks (primary on CBS)
  const text = cleanTags(html);

  const POS = "(QB|RB|WR|TE|K|DST)";
  const MARKERS = [
    "Weekly Breakdown", "Rostered", "YTD Stats", "AGE", "EXPERIENCE",
    "MATCHUP", "OPP VS", "YDS", "REC", "TD", "Add in this order"
  ].join("|");

  // Capture “First Last <POS> … {marker}”
const cardRegex = new RegExp(
  `([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){1,3})\\s+(QB|RB|WR|TE|K|DST)\\b[\\s\\S]{0,80}?(?:${MARKERS})`,
  "g"
);

  let cm: RegExpExecArray | null;
  while ((cm = cardRegex.exec(text)) !== null) {
    const rawName = cm[1].trim();
    const hint = cm[2].toUpperCase();
    push(rawName, hint, "card");
  }

  return out;
};
