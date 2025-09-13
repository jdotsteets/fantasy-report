// lib/classify.ts
// Canonical topic classifier with broader coverage and safe fallback to reduce NULLs.
// No `any` types.

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
  topics: Topic[]; // canonical only
  isStatic: boolean;
  /** True when the URL/title resolve to a single-player hub/profile page */
  isPlayerPage: boolean;
  /** Kebab-case slug (e.g., "devon-witherspoon") when isPlayerPage=true, else null */
  playerSlug: string | null;
};

const CANON: Topic[] = [
  "rankings",
  "start-sit",
  "waiver-wire",
  "injury",
  "dfs",
  "advice",
];

// Keyword sets (matched against title + url). Keep simple RegExps for speed.
// NOTE: add new patterns in the blocks below where commented. Keep them specific to avoid false positives.
const KW: Record<Topic, RegExp[]> = {
  rankings: [
    /rankings?\b/i,
    /ros\b/i,
    /rest[-\s]?of[-\s]?season/i,
    /tiers?\b/i,
    /top\s*\d+\b/i,
    /cheat\s*sheet/i,
    /projections?\b/i,
    // additions:
    /big\s*board\b/i, // e.g., "Big Board"
    /\bECR\b/i, // Expert Consensus Rankings
  ],
  "start-sit": [
    /start[-\s\/]?sit/i,
    /sit[-\s\/]?start/i,
    // handle straight + curly quotes + HTML entity for Start 'Em / Sit 'Em
    /start\s*(?:'|’|&#8217;|&#39;|&#x27;)?em/i,
    /sit\s*(?:'|’|&#8217;|&#39;|&#x27;)?em/i,
    /who\s+to\s+start/i,
    /who\s+should\s+i\s+start/i,
    /must[-\s]?start/i,
    // TODO: add house styles like "stard/sitd" if you encounter them
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
    /faab\b/i,
    /free\s*agents?\b/i,
    // additions:
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
    // additions (status & roster moves):
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
    // additions (common ailments):
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
    // additions:
    /showdown\b/i,
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
    // additions (picks/predictions/betting-ish analysis):
    /picks?\b/i,
    /score\s+predictions?\b/i,
    /bold\s+predictions?\b/i,
    /odds|spreads?|moneyline|over\/?under/i,
    /grades?|reactions?|winners|losers/i,
  ],
};

// ---------- Player-page classification (additions) ----------

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

const NAME_ONLY_PAT = /^(?:news:\s*)?[a-z][a-z.'\- ]+[a-z]$/i; // e.g., "Jarran Reed", "Devon Witherspoon"
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

  // 1) Host/path hints (most reliable)
  if (PLAYER_HOST_HINTS.some((h) => u.includes(h)) || PLAYER_URL_PAT.test(u)) {
    const parts = u.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    const raw = decodeURIComponent(
      last.replace(/\.(html|php|asp|aspx)$/i, "").replace(/-\d+$/, "")
    );
    const slug = toPlayerSlug(raw.replace(/^(profile|player|players?)\-/, ""));
    return { isPlayerPage: true, playerSlug: slug || null };
  }

  // 2) Title that’s *only* a name (often Rotowire/Yahoo blurbs)
  if (t && NAME_ONLY_PAT.test(t) && t.split(" ").length <= 4) {
    return { isPlayerPage: true, playerSlug: toPlayerSlug(t) };
  }

  return { isPlayerPage: false, playerSlug: null };
}

// ---------- Topic classification (existing) ----------

// URL path tokens that act as strong hints
// TIP: adding site-section paths here often boosts recall on vague titles.
const PATH_HINTS: Partial<Record<Topic, RegExp>> = {
  rankings: /\/(rankings?|projections?|tiers?)\//i,
  "waiver-wire": /\/(waiver[-]?wire|waivers?)\//i,
  "start-sit": /\/(start[-]?sit|sit[-]?start)\//i,
  injury: /\/(injur(?:y|ies)|inactives?|injury[-]?report)\//i,
  dfs: /\/(dfs|draftkings?|fanduel|prizepicks?|underdog)\//i,
};

// Lightweight site hints: treat these hosts *with /fantasy in the path* as fantasy-first
const FANTASY_HOST_HINT =
  /(fantasypros\.com|rotoballer\.com|rotowire\.com|numberfire\.com|draftsharks\.com|razzball\.com)/i;

function uniq<T>(arr: T[]): T[] {
  const s = new Set(arr);
  return Array.from(s);
}

// Minimal HTML-entity + punctuation normalizer to improve matching (e.g., Start &#8217;Em)
function normalizeForMatching(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&#39;|&#x27;/gi, "'")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreFromMatches(
  hay: string,
  urlPath: string
): Partial<Record<Topic, number>> {
  const score: Partial<Record<Topic, number>> = {};
  function add(t: Topic, n = 1) {
    score[t] = (score[t] ?? 0) + n;
  }

  for (const t of CANON) {
    for (const rx of KW[t]) if (rx.test(hay)) add(t, 1);
  }

  for (const [t, rx] of Object.entries(PATH_HINTS)) {
    if (rx && (rx as RegExp).test(urlPath)) add(t as Topic, 2); // stronger weight for path hints
  }

  return score;
}

function pickTopicsFromScore(
  score: Partial<Record<Topic, number>>
): Topic[] {
  const entries = Object.entries(score) as Array<[Topic, number]>;
  if (!entries.length) return [];
  entries.sort((a, b) => b[1] - a[1]);

  // tie-breakers: more specific over general advice
  const order: Topic[] = [
    "start-sit",
    "waiver-wire",
    "injury",
    "dfs",
    "rankings",
    "advice",
  ];
  const top = entries.filter((e) => e[1] === entries[0][1]).map((e) => e[0]);
  top.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const topics: Topic[] = uniq(
    [...top, ...entries.map((e) => e[0])]
  ).filter((t) => CANON.includes(t));
  return topics;
}

function toCanon(list: string[]): Topic[] {
  const out: Topic[] = [];
  for (const t of list) {
    const k = t.toLowerCase();
    if ((CANON as string[]).includes(k)) out.push(k as Topic);
  }
  return uniq(out);
}

export function looksLikePlayerPage(url: string, title?: string | null): boolean {
  const { isPlayerPage } = classifyPlayerPage(url, title);
  return isPlayerPage;
}

export function looksStatic(url: string): boolean {
  return /(\/tag\/|\/category\/|\/topics\/|\/series\/|fantasy-football-news\/?$)/i.test(
    url
  );
}

export function classifyArticle(args: {
  title?: string | null;
  url: string;
}): ClassifyResult {
  const titleRaw = (args.title ?? "").toString();
  const title = normalizeForMatching(titleRaw);
  const url = args.url;
  const hay = `${title} ${url}`.toLowerCase();

  // NEW: robust player-page detection
  const { isPlayerPage, playerSlug } = classifyPlayerPage(args.url, args.title);

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

  // Safe fallback: if nothing matched but it's clearly fantasy content, default to advice
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
