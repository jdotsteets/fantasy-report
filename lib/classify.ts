// lib/classify.ts
// Canonical topic classifier with broader coverage and safe fallback.
// Also exports a robust cleanTitle() for reuse by scraper/ingest.

// ---------------- Types ----------------

export type Topic =
  | "rankings"
  | "start-sit"
  | "waiver-wire"
  | "injury"
  | "dfs"
  | "advice";

export type ClassifyResult = {
  primary: Topic | null;
  secondary: Topic | null;
  topics: Topic[];
  isStatic: boolean;
  isPlayerPage: boolean;
  playerSlug: string | null;
};

// ---------------- Title cleaning (new/expanded) ----------------

/**
 * Aggressive-but-safe title normalizer used across pipeline.
 * Returns null when the string is clearly not a title.
 *
 * Use this anywhere you generate candidate items so the ingest
 * layer receives classifier-friendly titles.
 */
export function cleanTitle(input?: string | null): string | null {
  if (!input) return null;

  // Decode common HTML apostrophes/ampersands and collapse whitespace
  let t = String(input)
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&#39;|&#x27;|&apos;/gi, "'")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // Strip obvious UI chrome / non-content phrases that sneak into anchors
  t = t
    .replace(/\b(Read More|Continue Reading|Click (?:Here|to Read)|View More)\b/gi, "")
    .replace(/\b\d+\s+Comments?\b/gi, "")
    .replace(/\bLeave a comment\b/gi, "")
    .replace(/\bby\s+[A-Z][A-Za-z.'\-]+\b/g, "") // tailing "by Author"
    .replace(/\b\|\s*Razzball\b/gi, "") // site chrome
    .trim();

  // Strip leading/trailing pipes/dashes/colons
  t = t.replace(/^[\s\|–—\-:]+/, "").replace(/[\s\|–—\-:]+$/, "").trim();

  // Reject obvious non-titles
  if (!t || t.length < 6) return null; // very short
  if (/^(untitled|title)$/i.test(t)) return null;
  // pasted CSS/HTML or layout artifacts
  if (/[{}<>]/.test(t) && /\b(display|font|webkit|margin|padding)\b/i.test(t)) return null;

  // Defensive: reject single short tokens (e.g., "HOME", "NEWS")
  if (!/\s/.test(t) && t.length < 12) return null;

  // If the title is mostly punctuation after cleaning, drop it
  if (!/[a-z0-9]/i.test(t)) return null;

  return t;
}

// Lightweight normalizer just for matching/regex scoring (keeps more characters)
function normalizeForMatching(s: string): string {
  return String(s || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&#39;|&#x27;|&apos;/gi, "'")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------- Canon + keyword sets ----------------

const CANON: Topic[] = [
  "rankings",
  "start-sit",
  "waiver-wire",
  "injury",
  "dfs",
  "advice",
];

// Keep regexes specific to avoid false positives.
const KW: Record<Topic, RegExp[]> = {
  rankings: [
    /rankings?\b/i,
    /\bros\b/i,
    /rest[-\s]?of[-\s]?season/i,
    /tiers?\b/i,
    /top\s*\d+\b/i,
    /cheat\s*sheet/i,
    /projections?\b/i,
    /big\s*board\b/i,
    /\bECR\b/i,
  ],
  "start-sit": [
    /start[-\s\/]?sit/i,
    /sit[-\s\/]?start/i,
    /start\s*(?:'|’|&#8217;|&#39;|&#x27;)?em/i,
    /sit\s*(?:'|’|&#8217;|&#39;|&#x27;)?em/i,
    /who\s+to\s+start/i,
    /who\s+should\s+i\s+start/i,
    /must[-\s]?start/i,
  ],
  "waiver-wire": [
    /waiver[s-]?\s*wire/i,
    /waivers?\b/i,
    /pick\s*ups?\b/i,
    /adds?\b/i,
    /drops?\b/i,
    /stream(?:er|ing|s)?\b/i,
    /stash(?:es|ing)?\b/i,
    /watch\s*list/i,
    /\bfaab\b/i,
    /free\s*agents?\b/i,
    /\bFAB\b/i,
    /claims?\b/i,
    /adds?\/drops?/i,
    /priority\s+pickups?\b/i,
  ],
  injury: [
    /injur(?:y|ies)\b/i,
    /practice\s+report/i,
    /inactives?\b/i,
    /actives?\b/i,
    /questionable\b/i,
    /doubtful\b/i,
    /probable\b/i,
    /game[-\s]?time\s+decision/i,
    /did\s+not\s+practice|\bDNP\b/i,
    /limited\s+practice/i,
    /out\s+for\s+week\b/i,
    /return(?:ed)?\s+to\s+practice/i,
    /back\s+(?:to|at)\s+practice/i,
    /spotted\s+at\s+practice/i,
    /full\s+(?:participant|practice)/i,
    /injury\s+report/i,
    /game\s+status/i,
    /placed\s+on\s+(?:injured\s+reserve|IR)\b/i,
    /activated\s+from\s+IR\b/i,
    /designated\s+to\s+return/i,
    /\bPUP\b|physically\s+unable\s+to\s+perform|\bNFI\b/i,
    /concussion|hamstring|calf|groin|ankle|\bACL\b|\bMCL\b|\bPCL\b|high[\s-]*ankle/i,
  ],
  dfs: [
    /\bDFS\b/i,
    /DraftKings?/i,
    /FanDuel/i,
    /yahoo\s+daily/i,
    /PrizePicks?/i,
    /\bUnderdog\b/i,
    /\bGPP\b/i,
    /cash\s+game/i,
    /value\s+plays?/i,
    /lineups?\b/i,
    /prop[s]?\b/i,
    /(?:\b(?:dfs|draftkings?|fanduel|prizepicks?|underdog)\b.{0,40}\bshowdown\b|\bshowdown\b.{0,40}\b(?:dfs|draftkings?|fanduel)\b)/i,
    /\bshowdown\s+(?:slate|picks?|lineups?|captain|single[-\s]?game)\b/i,
    /player\s+pool\b/i,
    /optimizer\b/i,
  ],
  advice: [
    /sleepers?\b/i,
    /busts?\b/i,
    /starts?\b/i,
    /breakouts?\b/i,
    /buy\s*low|sell\s*high/i,
    /targets?\b/i,
    /strategy\b/i,
    /tips?\b/i,
    /lessons|takeaways?/i,
    /picks?\b/i,
    /score\s+predictions?\b/i,
    /bold\s+predictions?\b/i,
    /odds|spreads?|moneyline|over\/?under/i,
    /grades?|reactions?|winners|losers/i,
  ],
};

// ---------------- Player-page classification ----------------

const PLAYER_HOST_HINTS: string[] = [
  "rotowire.com/player",
  "rotowire.com/football/player",
  "espn.com/nfl/player",
  "pro-football-reference.com/players/",
  "nfl.com/players/",
  "fantasypros.com/nfl/players/",
  "draftkings.com/players/",
  "pff.com/nfl/players/",
];

const NAME_ONLY_PAT = /^(?:news:\s*)?[a-z][a-z.'\- ]+[a-z]$/i;
const PLAYER_URL_PAT = /(\/players?\/|\/player\/)/i;

function toPlayerSlug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s\-'.]/g, "")
    .replace(/['.]/g, "")
    .replace(/\s+/g, "-");
}

/** Robust detector for single-player hub/profile pages (returns slug if found). */
export function classifyPlayerPage(
  url: string,
  title?: string | null
): { isPlayerPage: boolean; playerSlug: string | null } {
  const u = (url || "").toLowerCase();
  const t = (title || "")?.trim();

  // 1) Strong URL hints
  if (PLAYER_HOST_HINTS.some((h) => u.includes(h)) || PLAYER_URL_PAT.test(u)) {
    const parts = u.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    const raw = decodeURIComponent(
      last.replace(/\.(html|php|asp|aspx)$/i, "").replace(/-\d+$/, "")
    );
    const slug = toPlayerSlug(raw.replace(/^(profile|player|players?)\-/, ""));
    return { isPlayerPage: true, playerSlug: slug || null };
  }

  // 2) Title that is just a name
  if (t && NAME_ONLY_PAT.test(t) && t.split(" ").length <= 4) {
    return { isPlayerPage: true, playerSlug: toPlayerSlug(t) };
  }

  return { isPlayerPage: false, playerSlug: null };
}

// ---------------- Topic classification engine ----------------

// URL path hints (section-based)
const PATH_HINTS: Partial<Record<Topic, RegExp>> = {
  rankings: /\/(rankings?|projections?|tiers?)\//i,
  "waiver-wire": /\/(waiver[-]?wire|waivers?)\//i,
  "start-sit": /\/(start[-]?sit|sit[-]?start)\//i,
  injury: /\/(injur(?:y|ies)|inactives?|injury[-]?report)\//i,
  dfs: /\/(dfs|draftkings?|fanduel|prizepicks?|underdog)\//i,
};

// Fantasy-heavy hosts (used for a safe fallback)
const FANTASY_HOST_HINT =
  /(fantasypros\.com|rotoballer\.com|rotowire\.com|numberfire\.com|draftsharks\.com|razzball\.com)/i;

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function scoreFromMatches(
  hay: string,
  urlPath: string
): Partial<Record<Topic, number>> {
  const score: Partial<Record<Topic, number>> = {};
  const add = (t: Topic, n = 1) => {
    score[t] = (score[t] ?? 0) + n;
  };

  for (const t of CANON) {
    for (const rx of KW[t]) if (rx.test(hay)) add(t, 1);
  }
  for (const [t, rx] of Object.entries(PATH_HINTS)) {
    if (rx && (rx as RegExp).test(urlPath)) add(t as Topic, 2);
  }
  return score;
}

function pickTopicsFromScore(
  score: Partial<Record<Topic, number>>
): Topic[] {
  const entries = Object.entries(score) as Array<[Topic, number]>;
  if (!entries.length) return [];
  entries.sort((a, b) => b[1] - a[1]);

  // tie-breaker preference (more specific first)
  const pref: Topic[] = [
    "start-sit",
    "waiver-wire",
    "injury",
    "dfs",
    "rankings",
    "advice",
  ];
  const topVal = entries[0][1];
  const top = entries.filter((e) => e[1] === topVal).map((e) => e[0]).sort((a, b) => pref.indexOf(a) - pref.indexOf(b));

  return uniq([...top, ...entries.map((e) => e[0])]).filter((t) => CANON.includes(t));
}

function toCanon(list: string[]): Topic[] {
  const out: Topic[] = [];
  for (const t of list) {
    const k = t.toLowerCase();
    if ((CANON as string[]).includes(k)) out.push(k as Topic);
  }
  return uniq(out);
}

// ---------------- Public helpers ----------------

export function looksLikePlayerPage(url: string, title?: string | null): boolean {
  return classifyPlayerPage(url, title).isPlayerPage;
}

// Treat site-section hubs as static (non-article) pages
export function looksStatic(url: string): boolean {
  return /(\/tag\/|\/category\/|\/topics\/|\/series\/|fantasy-football-news\/?$)/i.test(url);
}

// ---------------- Main classification ----------------

export function classifyArticle(args: {
  title?: string | null;
  url: string;
}): ClassifyResult {
  // First, make the title safe for downstream consumers.
  const safeTitle = cleanTitle(args.title);
  const titleForMatch = normalizeForMatching(safeTitle ?? args.title ?? "");
  const url = args.url;
  const hay = `${titleForMatch} ${url}`.toLowerCase();

  const { isPlayerPage, playerSlug } = classifyPlayerPage(url, safeTitle ?? args.title);

  const urlObj = (() => {
    try {
      return new URL(url);
    } catch {
      return null as URL | null;
    }
  })();
  const path = urlObj ? urlObj.pathname.toLowerCase() + "/" : "/";

  const score = scoreFromMatches(hay, path);
  let topics = pickTopicsFromScore(score);

  // Safe fallback: if nothing matched but looks fantasy-ish, default to "advice"
  const fantasyish =
    /\bfantasy\b/i.test(hay) ||
    (FANTASY_HOST_HINT.test(url) && /\/fantasy\//i.test(path));
  if (topics.length === 0 && fantasyish) topics = ["advice"];

  topics = toCanon(topics);
  const primary = topics[0] ?? null;
  const secondary = topics.find((t) => t !== primary) ?? null;

  return {
    primary,
    secondary,
    topics,
    isStatic: looksStatic(url),
    isPlayerPage,
    playerSlug,
  };
}
