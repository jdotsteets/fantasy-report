// lib/classifyTrade.ts
const TEAM_NAMES = [
  "49ers","Bears","Bengals","Bills","Broncos","Browns","Buccaneers","Cardinals","Chargers",
  "Chiefs","Colts","Commanders","Cowboys","Dolphins","Eagles","Falcons","Giants","Jaguars",
  "Jets","Lions","Packers","Panthers","Patriots","Raiders","Rams","Ravens","Saints","Seahawks",
  "Steelers","Texans","Titans","Vikings"
];
const TEAM_SHORT = [
  "SF","CHI","CIN","BUF","DEN","CLE","TB","ARI","LAC","KC","IND","WAS","DAL","MIA","PHI",
  "ATL","NYG","JAX","NYJ","DET","GB","CAR","NE","LV","LAR","BAL","NO","SEA","PIT","HOU","TEN","MIN"
];

const TRADE_VERBS = /(trade[sd]?|acquire[sd]?|send[s]?|deal[sd]?|land[ed]?|swap|in exchange for)/i;
const FANTASY_HINTS = /(fantasy|dynasty|redraft|keeper|buy low|sell high|trade target|trade targets|start\/sit|rankings|advice|waiver)/i;

function countTeamMentions(s: string): number {
  const t = ` ${s} `.toLowerCase();
  const names = TEAM_NAMES.filter(n => t.includes(` ${n.toLowerCase()} `)).length;
  const abbrs = TEAM_SHORT.filter(a => t.includes(` ${a.toLowerCase()} `)).length;
  return names + abbrs;
}

/** returns "news" for real NFL trades, "advice" for fantasy trade talk, or null to defer */
export function classifyTradeTitle(title: string): "news"|"advice"|null {
  if (!/trade/i.test(title)) return null;

  // Fantasy trade advice patterns (your "%trade%target%" rule included)
  if (FANTASY_HINTS.test(title) || /\btrade\b.*\btarget(s)?\b/i.test(title)) {
    // If it also looks like a real transaction, we’ll let the real-trade rule win below.
    // So don’t early-return here; just mark and keep checking.
  } else if (countTeamMentions(title) >= 2 && TRADE_VERBS.test(title)) {
    return "news"; // e.g., "Raiders trade Jakobi Meyers to Patriots"
  }

  // If it has "trade" but not two teams, treat as advice (values/targets/etc.)
  if (FANTASY_HINTS.test(title) || countTeamMentions(title) < 2) return "advice";

  return null;
}
