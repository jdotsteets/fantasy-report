// lib/ingestLogs.ts
import { dbQuery } from "@/lib/db";

/**
 * Why it happened (errors) AND what we did (info).
 * Keep these short; details go in `detail`.
 */
export type IngestReason =
  | "fetch_error"
  | "parse_error"
  | "scrape_no_matches"
  | "invalid_item"
  | "blocked_by_filter"
  | "non_nfl_league"
  | "upsert_inserted"
  | "upsert_updated"
  | "upsert_skipped"
  | "ok_insert"
  | "ok_update"
  | "filtered_out"
  | "section_captured"
  | "static_detected";

export type IngestLevel = "info" | "error";
export type IngestEvent = "start" | "discover" | "upsert" | "skip" | "error" | "finish";

// ───────────────────────── Column-aware insert ─────────────────────────

type TableColumns = {
  hasJobId: boolean;
  hasLevel: boolean;
  hasEvent: boolean;
  hasSourceName: boolean;
  hasMethod: boolean;
  hasAdapterKey: boolean;
  hasSelector: boolean;
  hasFeedUrl: boolean;
  hasHttpStatus: boolean;
  hasArticleId: boolean;
};

let cachedCols: TableColumns | null = null;

async function getIngestLogColumns(): Promise<TableColumns> {
  if (cachedCols) return cachedCols;

  const sql = `
    select lower(column_name) as column_name
    from information_schema.columns
    where table_name = 'ingest_logs'
  `;
  const { rows } = await dbQuery<{ column_name: string }>(sql);

  const names = new Set(rows.map((r) => r.column_name));
  cachedCols = {
    hasJobId: names.has("job_id"),
    hasLevel: names.has("level"),
    hasEvent: names.has("event"),
    hasSourceName: names.has("source_name"),
    hasMethod: names.has("method"),
    hasAdapterKey: names.has("adapter_key"),
    hasSelector: names.has("selector"),
    hasFeedUrl: names.has("feed_url"),
    hasHttpStatus: names.has("http_status"),
    hasArticleId: names.has("article_id"),
  };
  return cachedCols;
}

// ───────────────────────── Defaults / inference ─────────────────────────

const ERROR_REASONS: ReadonlySet<IngestReason> = new Set([
  "fetch_error",
  "parse_error",
  "scrape_no_matches",
  "invalid_item",
]);

function inferLevel(reason: IngestReason, provided?: IngestLevel | null): IngestLevel | null {
  if (provided) return provided;
  return ERROR_REASONS.has(reason) ? "error" : "info";
}

function inferEvent(reason: IngestReason, provided?: IngestEvent | null): IngestEvent | null {
  if (provided) return provided;
  if (ERROR_REASONS.has(reason)) return "error";
  if (reason === "upsert_inserted" || reason === "upsert_updated" || reason === "upsert_skipped") {
    return "upsert";
  }
  if (reason === "filtered_out" || reason === "blocked_by_filter" || reason === "non_nfl_league") {
    return "skip";
  }
  if (reason === "ok_insert" || reason === "ok_update" || reason === "section_captured" || reason === "static_detected") {
    return "discover";
  }
  return "discover";
}

// ───────────────────────── Public API ─────────────────────────

export type IngestMethod = "rss" | "scrape" | "adapter";

export async function logIngest(args: {
  sourceId: number;
  sourceName?: string | null;
  url?: string | null;
  title?: string | null;
  domain?: string | null;
  reason: IngestReason;
  detail?: string | null;
  jobId?: string | null;
  level?: IngestLevel | null;
  event?: IngestEvent | null;
  // optional context
  method?: IngestMethod | null;
  adapterKey?: string | null;
  selector?: string | null;
  feedUrl?: string | null;
  httpStatus?: number | null;
  articleId?: number | null;
}): Promise<void> {
  const {
    sourceId,
    sourceName,
    url,
    title,
    domain,
    reason,
    detail,
    jobId = null,
    level,
    event,
    method = null,
    adapterKey = null,
    selector = null,
    feedUrl = null,
    httpStatus = null,
    articleId = null,
  } = args;

  try {
    const cols = await getIngestLogColumns();

    const colNames: string[] = ["source_id", "url", "title", "domain", "reason", "detail"];
    const values: unknown[] = [sourceId, url ?? null, title ?? null, domain ?? null, reason, detail ?? null];

    if (cols.hasSourceName) {
      colNames.push("source_name");
      values.push(sourceName ?? null);
    }
    if (cols.hasJobId) {
      colNames.push("job_id");
      values.push(jobId);
    }
    if (cols.hasLevel) {
      colNames.push("level");
      values.push(inferLevel(reason, level));
    }
    if (cols.hasEvent) {
      colNames.push("event");
      values.push(inferEvent(reason, event));
    }
    if (cols.hasMethod) {
      colNames.push("method");
      values.push(method);
    }
    if (cols.hasAdapterKey) {
      colNames.push("adapter_key");
      values.push(adapterKey);
    }
    if (cols.hasSelector) {
      colNames.push("selector");
      values.push(selector);
    }
    if (cols.hasFeedUrl) {
      colNames.push("feed_url");
      values.push(feedUrl);
    }
    if (cols.hasHttpStatus) {
      colNames.push("http_status");
      values.push(httpStatus);
    }
    if (cols.hasArticleId) {
      colNames.push("article_id");
      values.push(articleId);
    }

    const placeholders = colNames.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `insert into ingest_logs (${colNames.join(", ")}) values (${placeholders})`;
    await dbQuery(sql, values);
  } catch (e) {
    // Don't let logging break ingestion
    const msg = (e as Error)?.message ?? String(e);
    console.warn("[ingest_logs] insert failed:", msg);
  }
}

// Convenience wrappers
export async function logIngestStart(sourceId: number, jobId?: string | null, method?: IngestMethod | null) {
  await logIngest({
    sourceId,
    reason: "static_detected",
    detail: "ingest started",
    jobId: jobId ?? null,
    level: "info",
    event: "start",
    method: method ?? null,
  });
}

export async function logIngestFinish(sourceId: number, jobId?: string | null, method?: IngestMethod | null) {
  await logIngest({
    sourceId,
    reason: "static_detected",
    detail: "ingest finished",
    jobId: jobId ?? null,
    level: "info",
    event: "finish",
    method: method ?? null,
  });
}
