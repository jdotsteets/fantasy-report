// app/src/writing/renderDrafts.ts
import type { Draft, Platform, Topic } from "../types";

/* ───────────────────────── Config ───────────────────────── */

const MAX_VARIANTS_PER_TOPIC = 3 as const; // safety; real count comes from caller
const TITLE_HOOK_MAX = 90;

/** If true, X body will NOT include a link phrase (worker adds /b/{id}). */
const OMIT_LINK_IN_X_BODY = true;

/* ───────────────────────── Utils ───────────────────────── */

function ensurePeriod(s: string): string {
  if (!s) return s;
  const last = s[s.length - 1];
  return /[.!?]/.test(last) ? s : `${s}.`;
}

function cleanTitle(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeConsecutiveWords(s: string): string {
  // collapse exact consecutive duplicates: "news reaction news reaction" -> "news reaction"
  return s.replace(/\b(\w+)(\s+\1\b)+/gi, "$1");
}

/* ─────────────── Generic/placeholder suppression ─────────────── */

const GENERIC_PHRASES: readonly string[] = [
  "news reaction",
  "reaction",
  "breaking",
  "update",
  "latest",
  "new post",
  "read more",
  "click here",
  "details",
  "story",
  "roundup",
];

function isGeneric(s: string): boolean {
  const n = normalize(s).replace(/[.!?]+$/g, "");
  if (!n) return true;
  for (const g of GENERIC_PHRASES) {
    if (n === g || n.startsWith(`${g} `) || n.endsWith(` ${g}`)) return true;
  }
  // If it’s just 1–2 short words, treat as generic
  const words = n.split(" ").filter(Boolean);
  if (words.length <= 2 && n.length < 14) return true;
  return false;
}

/** Quality gate for bodies; falls back to title if too weak. */
function needsFallbackToTitle(body: string, title: string): boolean {
  if (!body) return true;
  const b = normalize(dedupeConsecutiveWords(body));
  const t = normalize(cleanTitle(title));
  if (b.length < 12) return true;
  if (isGeneric(b)) return true;
  // overly repetitive like "update update." or "news news reaction."
  if (/\b(\w+)\b(?:\s+\1\b){1,}/i.test(b)) return true;
  // if body basically equals the generic angle/stat or just equals the title without link, allow but we may still keep it.
  return false;
}

/* ───────────────────────── Hook builder ─────────────────────────
   Strategy:
   - If we have a non-generic “angle”, lead with that (short and punchy).
   - Else: use the cleaned, truncated title.
----------------------------------------------------------------- */

function makeHook(t: Topic): string {
  const angle = (t.angle ?? "").trim();
  if (angle.length > 0 && !isGeneric(angle)) {
    const short = truncate(angle.replace(/\s+/g, " "), TITLE_HOOK_MAX);
    return short;
  }
  return truncate(cleanTitle(t.title), TITLE_HOOK_MAX);
}

/* ───────────────────────── Body/CTA builders ───────────────────────── */

function platformCta(platform: Platform): string | undefined {
  if (platform === "x" || platform === "threads") return undefined;
  return "More at thefantasyreport.com";
}

const LINK_PHRASES_BASE = {
  x: [
    // Intentionally unused if OMIT_LINK_IN_X_BODY = true
    `Full breakdown:`,
    `More:`,
    `Details:`,
  ],
  threads: [
    `Full breakdown:`,
    `More:`,
    `Details:`,
  ],
  instagram: [
    "Tap bio for waivers → thefantasyreport.com",
    "More in bio → thefantasyreport.com",
    "Full analysis in bio → thefantasyreport.com",
  ],
  tiktok: [
    "Full picks → thefantasyreport.com",
    "More → thefantasyreport.com",
    "Deep dive → thefantasyreport.com",
  ],
  facebook: [
    "Full write-up → thefantasyreport.com",
    "More analysis → thefantasyreport.com",
    "Details → thefantasyreport.com",
  ],
} as const;

type BaseKey = keyof typeof LINK_PHRASES_BASE;

/** If Platform includes alias channels, point them at a base key */
const PLATFORM_ALIAS: Partial<Record<Platform, BaseKey>> = {
  reels: "instagram",
  shorts: "tiktok",
  // add more aliases here as your Platform union grows
};

function phrasesFor(platform: Platform): readonly string[] {
  const key = (PLATFORM_ALIAS[platform] ?? platform) as BaseKey;
  return LINK_PHRASES_BASE[key] ?? LINK_PHRASES_BASE.facebook;
}

function makeBody(t: Topic, platform: Platform, variant: number): string {
  // sanitize placeholders from inputs
  const goodStat = (t.stat && !isGeneric(t.stat)) ? ensurePeriod(t.stat.trim()) : "";
  const goodAngle = (t.angle && !isGeneric(t.angle)) ? ensurePeriod(t.angle.trim()) : "";

  const lp = phrasesFor(platform);
  const linkPhrase = lp[variant % lp.length];

  const linkBit =
    platform === "x" && OMIT_LINK_IN_X_BODY
      ? "" // worker will append /b/{id}
      : (t.url ? `${linkPhrase} ${t.url}` : "").trim();

  // Alternate ordering a bit (but keep concise)
  const variants: string[] = [
    [goodStat, goodAngle, linkBit].filter(Boolean).join(" ").trim(),
    [goodAngle, goodStat, linkBit].filter(Boolean).join(" ").trim(),
    [(goodStat || goodAngle), linkBit].filter(Boolean).join(" ").trim(),
  ];

  let body = variants[variant % variants.length];

  // Clean up duplicates like "news reaction news reaction."
  body = dedupeConsecutiveWords(body);

  // Final quality gate: fallback to title if low quality
  if (needsFallbackToTitle(body, t.title)) {
    const titleOnly = cleanTitle(t.title);
    // keep link behavior per platform
    body = [titleOnly, linkBit].filter(Boolean).join(" ").trim();
  }

  return body;
}

/* ───────────────────────── Public API ───────────────────────── */

export async function renderDrafts(
  topics: Topic[],
  cfg: { platforms: Platform[]; variantsPerTopic: number }
): Promise<Draft[]> {
  const drafts: Draft[] = [];
  const perTopic = Math.min(cfg.variantsPerTopic, MAX_VARIANTS_PER_TOPIC);

  for (const t of topics) {
    const hook = makeHook(t); // one clean hook per topic

    for (const p of cfg.platforms) {
      for (let i = 0; i < perTopic; i += 1) {
        const body = makeBody(t, p, i);

        drafts.push({
          id: `${t.id}:${p}:v${i + 1}`,
          platform: p,
          hook, // title/angle driven; never generic
          body,
          cta: platformCta(p),
          mediaPath: undefined,
          link: t.url, // kept for non-X platforms
          status: "draft",
          scheduledFor: undefined,
          topicRef: t.id,
        });
      }
    }
  }

  return drafts;
}
