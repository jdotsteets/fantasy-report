// lib/social/threadBuilder.ts
import type { SectionKey } from "@/lib/sectionQuery";
import { composeThreadLead, composeThreadReplies } from "@/app/src/social/compose";
import { htmlDecode } from "@/app/src/utils/htmlDecode";

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
  const now = new Date();
  // Intl.DateTimeFormat with timeZone avoids manual DST math.
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" });
  const short = fmt.format(now); // Sun/Mon/Tue...
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? now.getUTCDay();
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
      // Monday
      leadHook = `🚨 Get an early start on ${weekBit} waiver-wire action!`;
      body = `First look at this week’s priority adds. 🧵`;
    } else if (wd === 2) {
      // Tuesday
      leadHook = `🔥 Don’t miss ${weekBit}’s top waiver-wire pickups!`;
      body = `Must-add targets before waivers process. 🧵`;
    } else {
      // Other days
      leadHook = `Top ${weekBit} waiver-wire targets 🧵`;
      body = `Key pickups and stashes to help your roster.`;
    }
  } else {
    leadHook = `🧠 Start/Sit calls ${weekBit} 🧵`;
    body = `Matchup-based pivots for lineup edges.`;
  }

  // Include the site link explicitly in the opener via composer "short"
  const lead = composeThreadLead({
    hook: leadHook,
    body,
    short: site,        // ensures the first tweet has https://www.thefantasyreport.com
    maxChars: 270,
  });

  // Replies: each line has decoded title + direct source URL
  const replyLines = items.map((r, idx) => {
    const title = htmlDecode((r.title ?? "").replace(/\s+/g, " ").trim());
    const src = r.source ? ` — ${r.source}` : "";
    const link = (r.url ?? "").trim();
    return `${idx + 1}. ${title}${src}\n${link}`;
  });

  const replies = composeThreadReplies(replyLines, 270);
  return [lead, ...replies];
}
