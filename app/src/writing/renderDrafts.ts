import type { Draft, Platform, Topic } from "../types";

/* ───────────────────────── Config & helpers ───────────────────────── */

type HookKey =
  | "stat_nudge"
  | "trend_watch"
  | "context_check"
  | "quick_tip"
  | "waiver_watch"
  | "signal_noise"
  | "micro_breakout"
  | "stop_overreacting"; // kept, but rare

type HookTemplate = {
  key: HookKey;
  weight: number; // higher => more frequent
  render: (t: Topic, variant: number) => string;
};

/** Hard cap so “Stop overreacting:” is rare per batch/topic */
const MAX_STOP_OVERREACTING_PER_TOPIC = 1;

/** Hook template pool (tweak weights to taste) */
const HOOK_TEMPLATES: HookTemplate[] = [
  {
    key: "stat_nudge",
    weight: 6,
    render: (t, v) => `Stat check: ${truncate(cleanTitle(t.title), 70)}`,
  },
  {
    key: "trend_watch",
    weight: 5,
    render: (t) => `Trend watch: ${truncate(cleanTitle(t.title), 70)}`,
  },
  {
    key: "context_check",
    weight: 4,
    render: (t) => `Quick context: ${truncate(cleanTitle(t.title), 70)}`,
  },
  {
    key: "quick_tip",
    weight: 4,
    render: (t) => `Heads up: ${truncate(cleanTitle(t.title), 70)}`,
  },
  {
    key: "waiver_watch",
    weight: 4,
    render: (t) => `Waiver watch: ${truncate(cleanTitle(t.title), 70)}`,
  },
  {
    key: "signal_noise",
    weight: 3,
    render: (t) => `Signal > noise: ${truncate(cleanTitle(t.title), 70)}`,
  },
  {
    key: "micro_breakout",
    weight: 3,
    render: (t) => `Quiet breakout: ${truncate(cleanTitle(t.title), 70)}`,
  },
  {
    key: "stop_overreacting",
    weight: 1, // RARE
    render: (t) => `The Latest: ${truncate(cleanTitle(t.title), 70)}`,
  },
];

function pickWeighted(
  pool: HookTemplate[],
  disallowKey?: HookKey
): HookTemplate {
  const allowed = disallowKey
    ? pool.filter((p) => p.key !== disallowKey)
    : pool;
  const total = allowed.reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * total;
  for (const p of allowed) {
    if ((roll -= p.weight) <= 0) return p;
  }
  return allowed[allowed.length - 1];
}

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

/* ───────────────────────── Public API ───────────────────────── */

export async function renderDrafts(
  topics: Topic[],
  cfg: { platforms: Platform[]; variantsPerTopic: number }
): Promise<Draft[]> {
  const drafts: Draft[] = [];

  for (const t of topics) {
    // Track per-topic usage so “Stop overreacting” is rare
    let stopOverreactingUsed = 0;

    for (const p of cfg.platforms) {
      for (let i = 0; i < cfg.variantsPerTopic; i += 1) {
        // Weighted opener with cap on "stop_overreacting"
        const hookTemplate =
          stopOverreactingUsed >= MAX_STOP_OVERREACTING_PER_TOPIC
            ? pickWeighted(HOOK_TEMPLATES, "stop_overreacting")
            : pickWeighted(HOOK_TEMPLATES);

        if (hookTemplate.key === "stop_overreacting") {
          stopOverreactingUsed += 1;
        }

        const hook = hookTemplate.render(t, i);
        const body = makeBody(t, p, i);

        drafts.push({
          id: `${t.id}:${p}:v${i + 1}`,
          platform: p,
          hook,
          body,
          cta: platformCta(p),
          mediaPath: undefined,
          link: t.url,
          status: "draft",
          scheduledFor: undefined,
          topicRef: t.id,
        });
      }
    }
  }

  return drafts;
}

/* ───────────────────────── Body/CTA builders ───────────────────────── */

function makeBody(t: Topic, platform: Platform, variant: number): string {
  // light variety in body ordering and link phrasing
  const stat = t.stat ? ensurePeriod(t.stat.trim()) : "";
  const takeaway = t.angle ? ensurePeriod(t.angle.trim()) : "";

/* ─────────── inside makeBody ─────────── */

const LINK_PHRASES_BASE = {
  x: [
    `Full breakdown: ${t.url}`,
    `More: ${t.url}`,
    `Details: ${t.url}`,
  ],
  threads: [
    `Full breakdown: ${t.url}`,
    `More: ${t.url}`,
    `Details: ${t.url}`,
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

/** If Platform includes alias channels, point them at a base key */
const PLATFORM_ALIAS: Partial<Record<Platform, keyof typeof LINK_PHRASES_BASE>> = {
  reels: "instagram",
  shorts: "tiktok",
  // add more aliases here as your Platform union grows
};

function phrasesFor(platform: Platform): readonly string[] {
  const baseKey = (PLATFORM_ALIAS[platform] ?? platform) as keyof typeof LINK_PHRASES_BASE;
  // fallback to a sane default if an unexpected platform sneaks in
  return LINK_PHRASES_BASE[baseKey] ?? LINK_PHRASES_BASE.facebook;
}

const lp = phrasesFor(platform);
const linkNote = lp[variant % lp.length];

  // Alternate ordering a bit
  const variants: string[] = [
    `${stat} ${takeaway} ${linkNote}`.trim(),
    `${takeaway} ${stat} ${linkNote}`.trim(),
    `${stat || takeaway} ${linkNote}`.trim(),
  ];

  return variants[variant % variants.length];
}

function platformCta(platform: Platform): string | undefined {
  if (platform === "x" || platform === "threads") return undefined;
  return "More at thefantasyreport.com";
}
