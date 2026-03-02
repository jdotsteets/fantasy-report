// app/src/writing/renderDrafts.ts
import type { Draft, Platform, Topic } from "@/app/src/types";
import { htmlDecode } from "@/app/src/utils/htmlDecode";

/* ───────────────────────── Config ───────────────────────── */

const MAX_VARIANTS_PER_TOPIC = 3 as const; // safety; real count comes from caller
const TITLE_HOOK_MAX = 90;

/** If true, X body will NOT include a link phrase (worker adds /b/{id}). */
const OMIT_LINK_IN_X_BODY = true;

/* ───────────────────────── Utils ───────────────────────── */

function ensurePeriod(s: string): string {
  if (!s) return s;
  const last = s[s.length - 1] ?? "";
  return /[.!?]/.test(last) ? s : `${s}.`;
}

function cleanText(s: string): string {
  // Decode entities, collapse whitespace, trim.
  return htmlDecode(s).replace(/\s+/g, " ").trim();
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
  // If body is already effectively the title, treat as weak (we'll handle dedupe later)
  if (b === t) return true;
  return false;
}

/* ───────────────────────── Hook builder ───────────────────────── */

function makeHook(t: Topic): string {
  const angle = cleanText(t.angle ?? "");
  if (angle.length > 0 && !isGeneric(angle)) {
    const short = truncate(angle, TITLE_HOOK_MAX);
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
const PLATFORM_ALIAS: Partial<Record<Platform, BaseKey>> = {
  reels: "instagram",
  shorts: "tiktok",
};

function phrasesFor(platform: Platform): readonly string[] {
  const key = (PLATFORM_ALIAS[platform] ?? platform) as BaseKey;
  return LINK_PHRASES_BASE[key] ?? LINK_PHRASES_BASE.facebook;
}

function makeBody(t: Topic, platform: Platform, variant: number): string {
  const goodStat = t.stat && !isGeneric(t.stat) ? ensurePeriod(cleanText(t.stat)) : "";
  const goodAngle = t.angle && !isGeneric(t.angle) ? ensurePeriod(cleanText(t.angle)) : "";

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
    body = [titleOnly, linkBit].filter(Boolean).join(" ").trim();
  }

  return body;
}

/* ─────────────── Hook/Body de-duplication (key fix) ─────────────── */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toAsciiLite(s: string): string {
  return (s ?? "")
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\u00A0/g, " ")    // nbsp
    .replace(/\u200B/g, "")     // zero-width space
    .replace(/\u2026/g, "...")  // ellipsis char → three dots
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingHookFromBody(hook: string, body: string): string {
  if (!hook || !body) return body;

  const h = toAsciiLite(cleanText(hook));
  let b = toAsciiLite(cleanText(body));

  // Exactly equal after normalization → drop entirely
  if (b.localeCompare(h, undefined, { sensitivity: "base" }) === 0) return "";

  // Flexible prefix: hook + optional small separator run (":", "-", "|", "...") + spaces
  const sep = String.raw`[\s]*[|:\-]*\.{0,3}[\s]*`;
  const re = new RegExp(`^${escapeRegex(h)}${sep}`, "i");

  // Remove once
  b = b.replace(re, "").trim();

  // If body *still* starts with hook (e.g., "Hook… Hook rest"), remove again
  if (b.toLowerCase().startsWith(h.toLowerCase())) {
    b = b.replace(re, "").trim();
  }

  return b;
}

function cleanTitle(s: string): string {
  return toAsciiLite(cleanText(s));
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
        let body = makeBody(t, p, i);

        // 🔑 Prevent duplicated headline: if body starts with (or equals) the hook, strip it.
        body = stripLeadingHookFromBody(hook, body);

        drafts.push({
          id: `${t.id}:${p}:v${i + 1}`,
          platform: p,
          hook,                  // title/angle driven; never generic; entities decoded
          body,                  // no duplicate of hook; may be empty on X (worker adds link)
          cta: platformCta(p),
          mediaPath: undefined,
          link: t.url,           // kept for non-X platforms
          status: "draft",
          scheduledFor: undefined,
          topicRef: t.id,
        });
      }
    }
  }

  return drafts;
}
