// lib/social/threadBuilder.ts
import type { SectionKey } from "@/lib/sectionQuery";
import { composeThreadLead } from "@/app/src/social/compose";
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
const TWEET_MAX = 270;

function weekdayInCentral(): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" });
  const short = fmt.format(new Date());
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? new Date().getUTCDay();
}

/** Trim title first so URL is always preserved. */
function buildReply(idx: number, titleRaw: string, source: string | null, url: string): string {
  const title = htmlDecode(titleRaw.replace(/\s+/g, " ").trim());
  const src = source ? ` — ${source}` : "";
  const link = (url ?? "").trim();
  const prefix = `${idx}. `;
  const tail = `\n${link}`;
  const budgetForTitle = TWEET_MAX - prefix.length - src.length - tail.length;

  const safeTitle =
    budgetForTitle > 0 && title.length > budgetForTitle
      ? title.slice(0, Math.max(0, budgetForTitle - 1)) + "…"
      : title;

  return `${prefix}${safeTitle}${src}${tail}`;
}

export function buildThread(cfg: ThreadCfg, rows: Row[]): string[] {
  const items = rows.slice(0, Math.max(1, Math.min(cfg.maxItems, 10)));
  const site = (cfg.siteRoot ?? DEFAULT_SITE).replace(/\/+$/, "");

  const weekBit = cfg.weekHint ? `Week ${cfg.weekHint}` : "this week";
  const wd = weekdayInCentral();

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

  // opener includes your site link
  const lead = composeThreadLead({ hook: leadHook, body, short: site, maxChars: TWEET_MAX });

  // replies with guaranteed links
  const replies = items.map((r, i) => buildReply(i + 1, r.title ?? "", r.source, r.url ?? ""));

  return [lead, ...replies];
}
