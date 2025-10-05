// app/src/social/compose.ts
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripRawLinks(text: string): string {
  return text.replace(/\bhttps?:\/\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
}

/** Remove the hook from start of body if repeated (case-insensitive). */
export function stripLeadingHook(hook: string, body: string): string {
  const h = (hook ?? "").trim();
  const b = (body ?? "").trim();
  if (!h || !b) return b;
  if (b.localeCompare(h, undefined, { sensitivity: "accent" }) === 0) return "";
  const re = new RegExp(`^${escapeRegex(h)}(?:[\\s\\-–—:|]+)?`, "i");
  return b.replace(re, "").trim();
}

/** Compose the lead tweet of a thread. Keeps hook, adds body/cta/short, trims length. */
export function composeThreadLead(opts: {
  hook: string;
  body?: string;
  cta?: string | null;
  short?: string | null;       // optional shortlink if you add one
  maxChars?: number;           // X hard limit 280; be safe at 270
}): string {
  const max = opts.maxChars ?? 270;
  const hook = (opts.hook ?? "").trim();
  const body = stripLeadingHook(hook, stripRawLinks(opts.body ?? ""));
  const parts: string[] = [hook];
  if (body) parts.push(body);
  if (opts.cta) parts.push(opts.cta);
  if (opts.short) parts.push(opts.short);
  let text = parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text;
}

/** Compose replies: each string becomes one tweet, trimmed to 270. */
export function composeThreadReplies(lines: string[], maxChars = 270): string[] {
  return lines
    .map((s) => stripRawLinks((s ?? "").trim()).replace(/\s{2,}/g, " "))
    .filter(Boolean)
    .map((t) => (t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t));
}
