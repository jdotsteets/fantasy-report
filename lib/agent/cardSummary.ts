import { dbQueryRow, dbQueryRows } from "@/lib/db";
import { callLLMWriter } from "@/lib/agent/llm";

const SYSTEM =
  "You are a fantasy football editor. " +
  "Write ONE short sentence (max 140 characters) summarizing fantasy impact or key news significance. " +
  "No prefixes like 'Why it matters', no emojis, no quotes. " +
  "Select ONE impact label: major_impact, value_up, risk, monitor. " +
  "Return JSON: { \"summary\": string, \"impact_label\": string, \"confidence\": number }.";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const IMPACT_LABELS = ["major_impact", "value_up", "risk", "monitor"] as const;
export type ImpactLabel = (typeof IMPACT_LABELS)[number];

const CONF_THRESHOLD = 0.7;

type ArticleRow = {
  id: number;
  title: string;
  url: string | null;
  canonical_url: string | null;
  domain: string | null;
  published_at: string | null;
  summary: string | null;
  fantasy_impact_label: string | null;
  fantasy_impact_confidence: number | null;
};

function clamp140(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 140) return clean;
  return clean.slice(0, 139).replace(/\s+\S*$/, "").trimEnd();
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return null;
}

function parseSummary(raw: string): {
  summary: string | null;
  label: ImpactLabel | null;
  confidence: number | null;
} {
  try {
    const parsed = JSON.parse(raw) as {
      summary?: unknown;
      impact_label?: unknown;
      confidence?: unknown;
    };

    const summary = typeof parsed.summary === "string" ? clamp140(parsed.summary) : null;
    const label =
      typeof parsed.impact_label === "string" &&
      (IMPACT_LABELS as readonly string[]).includes(parsed.impact_label)
        ? (parsed.impact_label as ImpactLabel)
        : null;
    const confidence = normalizeConfidence(parsed.confidence);

    return { summary: summary && summary.length ? summary : null, label, confidence };
  } catch {
    return { summary: null, label: null, confidence: null };
  }
}

async function fetchArticleById(articleId: number): Promise<ArticleRow | null> {
  const sql = `
    select id, title, url, canonical_url, domain,
           to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as published_at,
           summary,
           fantasy_impact_label,
           fantasy_impact_confidence
    from articles
    where id = $1
    limit 1
  `;
  return (await dbQueryRow<ArticleRow>(sql, [articleId])) ?? null;
}

async function fetchArticleByUrl(url: string): Promise<ArticleRow | null> {
  const sql = `
    select id, title, url, canonical_url, domain,
           to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as published_at,
           summary,
           fantasy_impact_label,
           fantasy_impact_confidence
    from articles
    where canonical_url = $1 or url = $1
    order by id desc
    limit 1
  `;
  return (await dbQueryRow<ArticleRow>(sql, [url])) ?? null;
}

async function updateSummary(
  articleId: number,
  summary: string,
  label: ImpactLabel | null,
  confidence: number | null
): Promise<void> {
  await dbQueryRows(
    `update articles set summary = $2, fantasy_impact_label = $3, fantasy_impact_confidence = $4 where id = $1`,
    [articleId, summary, label, confidence]
  );
}

export async function generateCardSummaryForArticle(
  articleId: number,
  hint?: { description?: string | null; excerpt?: string | null },
  opts?: { force?: boolean }
): Promise<{ ok: boolean; summary?: string; label?: ImpactLabel | null; confidence?: number | null }> {
  if (!Number.isFinite(articleId) || articleId <= 0) return { ok: false };

  const article = await fetchArticleById(articleId);
  if (!article) return { ok: false };

  const hasAll =
    article.summary &&
    article.summary.trim().length > 0 &&
    article.fantasy_impact_label &&
    typeof article.fantasy_impact_confidence === "number";

  if (hasAll && !opts?.force) {
    return {
      ok: true,
      summary: article.summary ?? undefined,
      label: (article.fantasy_impact_label as ImpactLabel) ?? null,
      confidence: article.fantasy_impact_confidence ?? null,
    };
  }

  const payload = {
    title: article.title,
    url: article.canonical_url ?? article.url,
    domain: article.domain,
    published_at: article.published_at,
    description: hint?.description ?? null,
    excerpt: hint?.excerpt ?? null,
  };

  const res = await callLLMWriter({ system: SYSTEM, user: payload, model: DEFAULT_MODEL });
  const parsed = parseSummary(res.text);
  if (!parsed.summary) return { ok: false };

  const label = parsed.confidence && parsed.confidence >= CONF_THRESHOLD ? parsed.label : null;
  await updateSummary(article.id, parsed.summary, label, parsed.confidence);

  return {
    ok: true,
    summary: parsed.summary,
    label,
    confidence: parsed.confidence,
  };
}

export async function ensureCardSummaryForUrl(
  url: string,
  hint?: { description?: string | null; excerpt?: string | null }
): Promise<void> {
  if (!url || !url.trim()) return;
  const row = await fetchArticleByUrl(url);
  if (!row) return;

  const hasAll =
    row.summary &&
    row.summary.trim().length > 0 &&
    row.fantasy_impact_label &&
    typeof row.fantasy_impact_confidence === "number";

  if (hasAll) return;
  await generateCardSummaryForArticle(row.id, hint);
}
