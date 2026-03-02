// lib/strings.ts
import he from "he"; // npm i he

/** Decode HTML entities, collapse spaces, and trim. */
export function normalizeTitle(raw: string): string {
  if (!raw) return "";
  let s = he.decode(raw);            // fixes &#039;, &amp;, etc.
  s = s.replace(/\s+/g, " ").trim(); // collapse weird spacing

  // Strip leading "NEWS", sometimes glued to the next word (e.g., "NEWSRanking")
  s = s.replace(/^NEWS[:\s-]*/i, "");     // "NEWS: Title" -> "Title"
  s = s.replace(/^NEWS(?=[A-Z])/i, "");   // "NEWSRanking ..." -> "Ranking ..."
  return s.trim();
}