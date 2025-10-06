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

function isMonday(): boolean {
  const now = new Date();
  // adjust to Central Time (UTC-5 or -6 depending on DST)
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.getDay() === 1;
}

function isTuesday(): boolean {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.getDay() === 2;
}

export function buildThread(cfg: ThreadCfg, rows: Row[]): string[] {
  const items = rows.slice(0, Math.max(1, Math.min(cfg.maxItems, 10)));
  const site = (cfg.siteRoot ?? DEFAULT_SITE).replace(/\/+$/, "");

  const weekBit = cfg.weekHint ? `Week ${cfg.weekHint}` : "this week";

  // 🧵 Dynamic headline based on day (Mon vs Tue)
  let leadHook = "";
  let body = "";

  if (cfg.section === "waiver-wire") {
    if (isMonday()) {
      leadHook = `🚨 Get an early start on ${weekBit} waiver wire action!`;
      body = `Here's your first look at this week’s top priority adds. 🧵`;
    } else if (isTuesday()) {
      leadHook = `🔥 Don't miss ${weekBit}'s top waiver wire pickups!`;
      body = `Here are the must-adds before waivers process. 🧵`;
    } else {
      leadHook = `Top ${weekBit} waiver wire targets 🧵`;
      body = `Key pickups and stashes to help your fantasy team.`;
    }
  } else {
    // start/sit fallback
    leadHook = `🧠 Start/Sit Calls ${weekBit} 🧵`;
    body = `Matchup-based pivots and lineup edges for ${weekBit}.`;
  }

  // Always include the site link in the lead tweet
  const lead = composeThreadLead({
    hook: leadHook,
    body: `${body} ${site}`,
    maxChars: 270,
  });

  // Replies — decode HTML and always include link
  const replyLines = items.map((r, idx) => {
    const title = htmlDecode((r.title ?? "").replace(/\s+/g, " ").trim());
    const src = r.source ? ` — ${r.source}` : "";
    const link = (r.url ?? "").trim();
    return `${idx + 1}. ${title}${src}\n${link}`;
  });

  const replies = composeThreadReplies(replyLines, 270);
  return [lead, ...replies];
}
