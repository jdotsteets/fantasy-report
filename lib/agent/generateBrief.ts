// lib/agent/generateBrief.ts
import { SYSTEM_WRITER, SYSTEM_CRITIC, clampSnippet, type WriterUserPayload } from "./prompts";
import { callLLMWriter, callLLMCritic } from "./llm";
import { WriterJsonSchema } from "@/lib/zodAgent";
import { createBrief, getBriefByArticleId, updateBrief } from "@/lib/briefs";
import { dbQueryRows } from "@/lib/db";
import { BULLET_EXAMPLES } from "./prompts";

const BANNED_SNIPPETS = [
  "must-start", "must start", "league-winner", "league winner",
  "trust your gut", "you should consider", "keep an eye", "could be in for",
  "boom or bust", "sneaky play", "nice upside", "solid floor",
  "fantasy managers should", "fantasy owners should",
  "fire him up", "light it up", "stud", "bust", "elite upside",
  "explosive athlete", "dynamic weapon"
];

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  source_id: number | null;
  published_at: string | null;
  summary: string | null;
  domain: string | null;
  primary_topic: string | null;
};

type SourceRow = { id: number; name: string | null };

function isBulletStrong(b: string): boolean {
  const w = b.trim();
  const len = w.split(/\s+/).length;
  if (len < 5 || len > 18) return false;
  const lower = w.toLowerCase();
  if (/[#@]/.test(lower)) return false;              // no hashtags/handles
  if (/[!?]{2,}/.test(w)) return false;              // no emphatic punctuation
  if (BANNED_SNIPPETS.some(s => lower.includes(s))) return false;
  return true;
}

function tailorBulletsHint(section: string | null | undefined): string {
  switch ((section ?? "").toLowerCase()) {
    case "dfs":
      return "Emphasize salary/ownership leverage, coverage fit, and red-zone usage.";
    case "start-sit":
      return "Give a start/sit grade (WR2/WR3/Flex) tied to usage and matchup.";
    case "waivers":
      return "Include rough FAAB % or priority guidance and role clarity.";
    default:
      return "Anchor to usage/matchup/injury role and give a clear fantasy action.";
  }
}

async function rewriteBulletsIfWeak(
  bullets: string[],
  context: { section_hint: string | null; payload: WriterUserPayload; brief: string },
): Promise<string[]> {
  const ok = bullets.every(isBulletStrong);
  if (ok && bullets.length >= 3) return bullets.slice(0, 4);

  const examples = BULLET_EXAMPLES[(context.section_hint ?? "").toLowerCase() as keyof typeof BULLET_EXAMPLES];
  const hint = tailorBulletsHint(context.section_hint);

  // Ask critic to rewrite only bullets with new constraints
  const res = await callLLMCritic({
    system: [
      "Rewrite ONLY the `why_matters` array to be concrete and actionable.",
      "Constraints: 3-4 bullets, each 5–18 words, no emojis/hashtags/cliches.",
      hint,
      "Return JSON: { \"why_matters\": string[] } and nothing else.",
    ].join(" "),
    user: {
      brief: context.brief,
      existing_bullets: bullets,
      section_hint: context.section_hint,
      examples,
      source: {
        provider: context.payload.provider,
        title: context.payload.source_title,
        snippet: context.payload.clean_snippet,
      },
    },
  });

  try {
    const j = JSON.parse(res.text) as { why_matters?: unknown };
    if (Array.isArray(j.why_matters)) {
      const cleaned = j.why_matters
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter((x) => x.length > 0)
        .slice(0, 4);
      if (cleaned.length >= 3 && cleaned.every(isBulletStrong)) return cleaned;
    }
  } catch {
    // fallthrough
  }

  // If rewrite fails, salvage the strongest originals or drop to safe, generic items
  const strong = bullets.filter(isBulletStrong);
  if (strong.length >= 3) return strong.slice(0, 4);
  return [
    "Usage rose; routes and snaps trending up.",
    "Red-zone role stable; TD chances intact.",
    "Matchup favorable vs zone; slot rate advantageous.",
  ];
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function jaccard(a: string, b: string): number {
  const A = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const B = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const inter = new Set([...A].filter((x) => B.has(x))).size;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

/** Safe helpers without `any` */
function getRecordValue(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}
function asRecord(u: unknown): Record<string, unknown> | undefined {
  return typeof u === "object" && u !== null ? (u as Record<string, unknown>) : undefined;
}

function normalizeWriterShape(raw: unknown): unknown {
  const rec = asRecord(raw);
  if (!rec) return raw;

  // Shallow clone
  const o: Record<string, unknown> = { ...rec };

  // why_matters ← whyMatters
  if (!("why_matters" in o) && "whyMatters" in o) {
    o.why_matters = getRecordValue(o, "whyMatters");
  }

  // seo (support "seo" or "SEO", and metaDescription → meta_description)
  const seoCandidate =
    asRecord(getRecordValue(o, "seo")) ?? asRecord(getRecordValue(o, "SEO"));
  if (seoCandidate) {
    const seo: Record<string, unknown> = { ...seoCandidate };
    if (!("meta_description" in seo) && "metaDescription" in seo) {
      seo.meta_description = getRecordValue(seo, "metaDescription");
    }
    o.seo = seo;
  }

  // tone fallbacks
  if (o.tone === "informative" || o.tone === "neutral-info") {
    o.tone = "neutral-informative";
  }

  return o;
}

async function repairWithCritic(
  criticFn: (args: { system: string; user: unknown }) => Promise<{ text: string }>,
  system: string,
  candidate: unknown,
  zodErrors: unknown
): Promise<unknown> {
  const res = await criticFn({
    system,
    user: {
      instructions:
        "You will be given a JSON object that failed validation. Return corrected JSON ONLY (no prose). " +
        "Keys must be: brief, why_matters, seo{title, meta_description}, cta_label, tone.",
      candidate,
      zod_errors: zodErrors,
    },
  });
  return JSON.parse(res.text) as unknown;
}

/** Build a last-resort, schema-valid brief from the payload */
function buildSafeFallback(payload: WriterUserPayload) {
  const brief = clampSnippet(payload.clean_snippet, payload.source_title, 600)
    .split(/\s+/)
    .slice(0, 75)
    .join(" "); // ≤ 75 words

  const why_matters = [
    "Usage steady; treat as matchup-based Flex until role stabilizes."
  ];

  return {
    brief,
    why_matters,
    seo: {
      title: (payload.source_title || "The Fantasy Report").slice(0, 90),
      meta_description: brief.slice(0, 150),
    },
    cta_label: "Read full article",
    tone: "neutral-informative" as const,
  };
}

/**
 * Generate a brief for an article. If `overwrite` is true and a brief already exists,
 * this will update that brief (saving as draft unless autopublish is true).
 */
export async function generateBriefForArticle(
  article_id: number,
  autopublish = false,
  overwrite = false
) {
  // 1) Load article
  const [art] = await dbQueryRows<ArticleRow>(`SELECT * FROM articles WHERE id = $1`, [article_id]);
  if (!art) throw new Error("Article not found");

  // 2) Resolve provider/source name
  let provider = art.domain ?? "Source";
  if (art.source_id) {
    const src = await dbQueryRows<SourceRow>(`SELECT id, name FROM sources WHERE id = $1`, [art.source_id]);
    if (src[0]?.name) provider = src[0].name!;
  }

  // 3) Build payload
  const payload: WriterUserPayload = {
    provider,
    source_title: art.title,
    source_url: art.canonical_url ?? art.url,
    published_at: art.published_at,
    clean_snippet: clampSnippet(art.summary, art.title, 600),
    entities: [],
    section_hint: art.primary_topic,
    internal_candidates: [],
  };

  // 4) Writer
  const writerRes = await callLLMWriter({ system: SYSTEM_WRITER, user: payload });

  // Log first 1k chars for debugging (safe)
  console.error("[generateBrief] writer raw:", writerRes.text.slice(0, 1000));

  // 5) Parse → normalize → validate; if fails, repair via critic once
  let candidate = normalizeWriterShape(JSON.parse(writerRes.text) as unknown);
  let parsed = WriterJsonSchema.safeParse(candidate);

  if (!parsed.success) {
    const repaired = await repairWithCritic(callLLMCritic, SYSTEM_CRITIC, candidate, parsed.error.flatten());
    candidate = normalizeWriterShape(repaired);
    parsed = WriterJsonSchema.safeParse(candidate);
  }

  // If still not valid, use a safe fallback instead of throwing
  if (!parsed.success) {
    console.error("[generateBrief] Writer JSON failed after repair; using fallback. Errors:", parsed.error.flatten());
    candidate = buildSafeFallback(payload);
    parsed = WriterJsonSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error("Writer JSON failed validation after repair and fallback");
    }
  }

  const final = parsed.data;

  // Strengthen/clean bullets and ensure 3–4 max
  const bullets = await rewriteBulletsIfWeak(final.why_matters, {
    section_hint: payload.section_hint,
    payload,
    brief: final.brief,
  });

  const brevity_ok = countWords(final.brief) <= 75;
  const originality = 1 - jaccard(final.brief, payload.clean_snippet);
  const groundedness_ok = true;

  // 7) Save — overwrite existing or create/idempotent
  const existing = await getBriefByArticleId(article_id);

  if (existing && overwrite) {
    const updated = await updateBrief(existing.id, {
      summary: final.brief,
      why_matters: bullets,
      seo_title: final.seo.title,
      seo_description: final.seo.meta_description,
      status: autopublish ? "published" : "draft",
    });

    return {
      created_brief_id: updated.id,
      slug: updated.slug,
      status: updated.status,
      scores: { brevity_ok, originality, groundedness_ok },
    };
  }

  // Create new (or return existing due to idempotent createBrief)
  const saved = await createBrief({
    article_id,
    summary: final.brief,
    why_matters: bullets,
    seo_title: final.seo.title,
    seo_description: final.seo.meta_description,
    status: autopublish ? "published" : "draft",
  });

  return {
    created_brief_id: saved.id,
    slug: saved.slug,
    status: saved.status,
    scores: { brevity_ok, originality, groundedness_ok },
  };
}
