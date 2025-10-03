// app/src/utils/htmlDecode.ts
// Minimal, fast decoder for the entities we actually see in feeds.
export function htmlDecode(str: string): string {
  if (!str) return str;
  return str
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
