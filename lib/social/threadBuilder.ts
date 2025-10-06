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

  // Lead tweet: explicitly mention upcoming Week # waivers and include site link
  const weekBit = cfg.weekHint ? `Week ${cfg.weekHint} ` : "";
  const leadHook =
    cfg.section === "waiver-wire"
      ? `${weekBit}Waiver Wire targets`
      : `${weekBit}Start/Sit calls to consider`;

  const body =
    cfg.section === "waiver-wire"
      ? "Top pickups and quick notes."
      : "Key plays and pivots based on matchups.";

  // Include site link on the lead via `short`
  const lead = composeThreadLead({
    hook: leadHook,
    body,
    short: site,      // <-- ensures the first tweet links to thefantasyreport.com
    maxChars: 270,
  });

  // Replies: each includes a direct link to the source article
  const replyLines = items.map((r, idx) => {
    const t = (r.title ?? "").replace(/\s+/g, " ").trim();
    const src = r.source ? ` — ${r.source}` : "";
    const u = (r.url ?? "").trim();
    // force a direct link on every reply line
    return `${idx + 1}. ${t}${src}\n${u}`;
  });

  const replies = composeThreadReplies(replyLines, 270);

  return [lead, ...replies];
}
