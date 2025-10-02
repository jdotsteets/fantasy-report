// lib/social/threadBuilder.ts
import type { SectionRow, SectionKey } from "@/lib/sectionQuery";

export type ThreadConfig = {
  section: Extract<SectionKey, "waiver-wire" | "start-sit">;
  weekHint?: number | null;          // optional, will be appended to headline if present
  siteRoot?: string;                 // default "https://www.thefantasyreport.com"
  maxItems?: number;                 // default 5
};

export type ThreadPost = { text: string };

const MAX_TWEET = 280;

function ensureMax(s: string, limit: number): string {
  if (s.length <= limit) return s;
  // reserve 1 char for ellipsis
  return s.slice(0, Math.max(0, limit - 1)) + "…";
}

function linkFrom(row: SectionRow): string {
  // Prefer canonical_url if present; fallback to url.
  return (row.canonical_url && row.canonical_url.trim().length ? row.canonical_url : row.url) || "";
}

function openerFor(section: ThreadConfig["section"], weekHint?: number | null): string {
  if (section === "waiver-wire") {
    return weekHint && weekHint > 0
      ? `🚨 Top Waiver Wire Columns — Week ${weekHint} 🧵`
      : "🚨 Top Waiver Wire Columns 🧵";
  }
  // start-sit
  return weekHint && weekHint > 0
    ? `🧠 Start/Sit Columns — Week ${weekHint} 🧵`
    : "🧠 Start/Sit Columns 🧵";
}

export function buildThread(config: ThreadConfig, rows: SectionRow[]): ThreadPost[] {
  const maxItems = Math.max(1, Math.min(config.maxItems ?? 5, 10));
  const items = rows.slice(0, maxItems);

  const opener = openerFor(config.section, config.weekHint);
  const posts: ThreadPost[] = [{ text: ensureMax(opener, MAX_TWEET) }];

  items.forEach((row, i) => {
    const provider = row.source ? row.source : "";
    const base = `${i + 1}. ${provider ? `${provider} — ` : ""}${row.title}`;
    const url = linkFrom(row);
    // Keep each item within 280 chars. Add newline before URL for clarity.
    const text = ensureMax(`${base}\n${url}`, MAX_TWEET);
    posts.push({ text });
  });

  const cta = "More fantasy football headlines updated all day:\nhttps://www.thefantasyreport.com";
  posts.push({ text: ensureMax(cta, MAX_TWEET) });

  return posts;
}
