// lib/social/threadBuilder.ts
import type { SectionKey } from "@/lib/sectionQuery";
import { composeThreadLead, composeThreadReplies } from "@/app/src/social/compose";
import { htmlDecode } from "@/app/src/utils/htmlDecode";

const REPLY_MAX = 270;

// Always keep the URL by trimming the title first
function replyTextWithLink(idx: number, title: string, source: string | null, url: string): string {
  const src = source ? ` — ${source}` : "";
  const cleanUrl = (url ?? "").trim();
  const prefixBase = `${idx}. `;
  const newlineAndUrl = `\n${cleanUrl}`;

  const budgetForTitle = REPLY_MAX - prefixBase.length - newlineAndUrl.length - src.length;
  const safeTitle =
    budgetForTitle > 0 && title.length > budgetForTitle
      ? `${title.slice(0, Math.max(0, budgetForTitle - 1))}…`
      : title;

  return `${prefixBase}${safeTitle}${src}${newlineAndUrl}`;
}

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
  siteRoot?: string;
};

const DEFAULT_SITE = "https://www.thefantasyreport.com";

/** Central Time weekday helper (no external libs) */
function weekdayInCentral(): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" });
  const short = fmt.format(new Date()); // Sun/Mon/Tue...
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? new Date().getUTCDay();
}

export function buildThread(cfg: ThreadCfg, rows: Row[]): string[] {
  const items = rows.slice(0, Math.max(1, Math.min(cfg.maxItems, 10)));
  const site = (cfg.siteRoot ?? DEFAULT_SITE).replace(/\/+$/, "");

  const weekBit = cfg.weekHint ? `Week ${cfg.weekHint}` : "this week";
  const wd = weekdayInCentral();

  // 🧵 Thready opener variants (Mon/Tue special)
  let leadHook = "";
  let body = "";

  if (cfg.section === "waiver-wire") {
    if (wd === 1) {
      leadHook = `🚨 Get an early start on ${weekBit} waiver-wire action!`;
      body = `First look at this week’s priority adds. 🧵`;
    } else if (wd === 2) {
      leadHook = `🔥 Don’t miss ${weekBit}’s top waiver-wire pickups!`;
      body = `Must-add targets before waivers process. 🧵`;
    } else {
      leadHook = `Top ${weekBit} waiver-wire targets 🧵`;
      body = `Key pickups and stashes to help your roster.`;
    }
  } else {
    leadHook = `🧠 Start/Sit calls ${weekBit} 🧵`;
    body = `Matchup-based pivots for lineup edges.`;
  }

  // Include site link in opener via composer "short"
  const lead = composeThreadLead({
    hook: leadHook,
    body,
    short: site,
    maxChars: 270,
  });

  // Replies — decoded title + guaranteed direct link
  const replyLines = items.map((r, i) => {
    const title = htmlDecode((r.title ?? "").replace(/\s+/g, " ").trim());
    return replyTextWithLink(i + 1, title, r.source, r.url ?? "");
  });

  const replies = composeThreadReplies(replyLines, REPLY_MAX);

  // ✅ Return the full thread
  return [lead, ...replies];
}
