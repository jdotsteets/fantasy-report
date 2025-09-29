//app/src/writing/renderDrafts.ts
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

/* ───────────────────────── Hook builder ─────────────────────────
   Strategy:
   - If we have an explicit “angle”, lead with that (short and punchy).
   - Else: use the cleaned, truncated title (no generic prefixes).
   Keeps the hook tightly tied to the article.
----------------------------------------------------------------- */

function makeHook(t: Topic): string {
  const angle = (t.angle ?? "").trim();
  if (angle.length > 0) {
    // keep it short and actionable
    const short = truncate(angle.replace(/\s+/g, " "), TITLE_HOOK_MAX);
    return short;
  }
  // fallback: title-only
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
  const stat = t.stat ? ensurePeriod(t.stat.trim()) : "";
  const takeaway = t.angle ? ensurePeriod(t.angle.trim()) : "";

  const lp = phrasesFor(platform);
  const linkPhrase = lp[variant % lp.length];

  const linkBit =
    platform === "x" && OMIT_LINK_IN_X_BODY
      ? "" // worker will append /b/{id}
      : (t.url ? `${linkPhrase} ${t.url}` : "").trim();

  // Alternate ordering a bit (but keep concise)
  const variants: string[] = [
    [stat, takeaway, linkBit].filter(Boolean).join(" ").trim(),
    [takeaway, stat, linkBit].filter(Boolean).join(" ").trim(),
    [(stat || takeaway), linkBit].filter(Boolean).join(" ").trim(),
  ];

  return variants[variant % variants.length];
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
          hook,                         // no generic “keys”; title/angle driven
          body,
          cta: platformCta(p),
          mediaPath: undefined,
          link: t.url,                  // kept for non-X platforms
          status: "draft",
          scheduledFor: undefined,
          topicRef: t.id,
        });
      }
    }
  }

  return drafts;
}
