// lib/social/threadBuilder.ts
import type { SectionKey } from "@/lib/sectionQuery";
import { composeThreadLead, composeThreadReplies } from "@/app/src/social/compose";

// Minimal row shape expected from fetchSectionItems()
type Row = {
  title: string;
  url: string;
  source: string | null;
  published_at?: string | null;
};

export function buildThread(
  cfg: { section: Extract<SectionKey, "waiver-wire" | "start-sit">; weekHint: number | null; maxItems: number },
  rows: Row[]
): string[] {
  const items = rows.slice(0, Math.max(1, Math.min(cfg.maxItems, 10)));

  // Lead tweet: a clean headline for the thread
  const weekBit = cfg.weekHint ? ` (Week ${cfg.weekHint})` : "";
  const leadHook =
    cfg.section === "waiver-wire"
      ? `Top Waiver Wire targets${weekBit}`
      : `Start/Sit calls to consider${weekBit}`;

  // Optional body blurb
  const body =
    cfg.section === "waiver-wire"
      ? `Here are notable adds and quick notes.`
      : `Key plays and pivots based on matchups.`;

  const lead = composeThreadLead({ hook: leadHook, body });

  // Replies: bullet-ish lines with title + url
  const replyLines = items.map((r) => {
    const t = r.title.replace(/\s+/g, " ").trim();
    const u = r.url;
    const src = r.source ? ` — ${r.source}` : "";
    return `• ${t}${src} ${u}`;
  });

  const replies = composeThreadReplies(replyLines);

  return [lead, ...replies];
}
