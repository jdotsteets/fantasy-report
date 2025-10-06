// lib/social/threadBuilder.ts
import type { SectionKey } from "@/lib/sectionQuery";
import { composeThreadLead, composeThreadReplies } from "@/app/src/social/compose";
import { htmlDecode } from "@/app/src/utils/htmlDecode";

// Minimal row shape expected from fetchSectionItems()
type Row = {
  title: string;
  url: string;
  source: string | null;
  published_at?: string | null;
};

type ThreadCfg = {
  section: Extract<SectionKey, "waiver-wire" | "start-sit">;
  weekHint: number | null;
  maxItems: number;
  siteRoot?: string; // optional, defaults to thefantasyreport.com
};

const DEFAULT_SITE = "https://www.thefantasyreport.com";

export function buildThread(cfg: ThreadCfg, rows: Row[]): string[] {
  const items = rows.slice(0, Math.max(1, Math.min(cfg.maxItems, 10)));
  const site = (cfg.siteRoot ?? DEFAULT_SITE).replace(/\/+$/, "");

  // Lead tweet: explicitly mention upcoming Week # + site link
  const weekBit = cfg.weekHint ? `Week ${cfg.weekHint} ` : "";
  const leadHook =
    cfg.section === "waiver-wire"
      ? `${weekBit}Waiver Wire targets`
      : `${weekBit}Start/Sit calls to consider`;

  const body =
    cfg.section === "waiver-wire"
      ? "Top pickups and quick notes."
      : "Key plays and pivots based on matchups.";

  const lead = composeThreadLead({
    hook: leadHook,
    body,
    short: site,     // first tweet links to thefantasyreport.com
    maxChars: 270,
  });

  // Replies: each includes decoded title + direct source link
  const replyLines = items.map((r, idx) => {
    const rawTitle = (r.title ?? "").replace(/\s+/g, " ").trim();
    const title = htmlDecode(rawTitle);            // ← decode &#038;, &#39;, etc.
    const src = r.source ? ` — ${r.source}` : "";
    const u = (r.url ?? "").trim();
    return `${idx + 1}. ${title}${src}\n${u}`;
  });

  const replies = composeThreadReplies(replyLines, 270);

  return [lead, ...replies];
}
