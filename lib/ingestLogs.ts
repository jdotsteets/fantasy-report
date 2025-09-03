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
  | "filtered_out";

/**
 * Unified logger. Safe: will never throw up the call chain.
 * Writes only the columns your table has.
 */
export async function logIngest(args: {
  sourceId: number;
  sourceName?: string | null;
  url?: string | null;
  title?: string | null;
  domain?: string | null;
  reason: IngestReason;
  detail?: string | null;
}) {
  const { sourceId, url, title, domain, reason, detail } = args;
  try {
    await dbQuery(
      `
      INSERT INTO ingest_logs (source_id, url, title, domain, reason, detail)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [sourceId, url ?? null, title ?? null, domain ?? null, reason, detail ?? null]
    );
  } catch (e) {
    // Don't let logging break ingestion
    console.warn("[ingest_logs] insert failed:", (e as Error)?.message);
  }
}

/** Back-compat shim so existing calls still work. */
export async function logIngestError(args: {
  sourceId: number;
  sourceName?: string | null;
  url?: string | null;
  title?: string | null;
  domain?: string | null;
  reason: Extract<IngestReason, "fetch_error" | "parse_error" | "scrape_no_matches" | "invalid_item" | "filtered_out">;
  detail?: string | null;
}) {
  return logIngest(args);
}
