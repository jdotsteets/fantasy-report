// app/src/social/compose.ts

/* ─────────────── utils ─────────────── */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normalize unicode punctuation/spacing so text comparisons are reliable. */
function toAsciiLite(s: string): string {
  return (s ?? "")
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\u00A0/g, " ")   // nbsp
    .replace(/\u200B/g, "")    // zero-width space
    .replace(/\u2026/g, "...") // ellipsis char → three dots
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip raw http(s):// links and collapse leftover whitespace. */
export function stripRawLinks(text: string): string {
  return (text ?? "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Remove the hook from the start of body if repeated (robust to punctuation/ellipsis). */
export function stripLeadingHook(hookText: string, bodyText: string): string {
  const h = toAsciiLite((hookText ?? "").trim());
  let b = toAsciiLite((bodyText ?? "").trim());
  if (!h || !b) return b;

  // If equal after normalization, drop entirely.
  if (b.localeCompare(h, undefined, { sensitivity: "base" }) === 0) return "";

  // Flexible prefix: hook + optional small separator run + spaces
  const sep = String.raw`[\s]*[|:\-]*\.{0,3}[\s]*`;
  const re = new RegExp(`^${escapeRegex(h)}${sep}`, "i");

  // Remove once…
  b = b.replace(re, "").trim();
  // …and if a “Hook … Hook rest” pattern remains, remove again.
  if (b.toLowerCase().startsWith(h.toLowerCase())) {
    b = b.replace(re, "").trim();
  }
  return b;
}

/** Compose the lead tweet of a thread. Keeps hook, adds body/cta/short, trims length. */
export function composeThreadLead(opts: {
  hook: string;
  body?: string;
  cta?: string | null;
  short?: string | null;       // optional shortlink if you add one
  maxChars?: number;           // safe limit for X; default 270
}): string {
  const max = Math.max(1, opts.maxChars ?? 270);
  const hookText = (opts.hook ?? "").trim();
  const body = stripLeadingHook(hookText, stripRawLinks(opts.body ?? ""));
  const parts: string[] = [hookText];
  if (body) parts.push(body);
  if (opts.cta) parts.push(opts.cta);
  if (opts.short) parts.push(opts.short);

  let text = parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text;
}

/** Compose replies: each string becomes one tweet, trimmed to maxChars (default 270). */
export function composeThreadReplies(lines: string[], maxChars = 270): string[] {
  const limit = Math.max(1, maxChars);
  return lines
    .map((s) => stripRawLinks(toAsciiLite((s ?? "").trim())).replace(/\s{2,}/g, " "))
    .filter(Boolean)
    .map((t) => (t.length > limit ? `${t.slice(0, limit - 1)}…` : t));
}
