// lib/db.ts
import { Pool, PoolConfig, QueryResult, QueryResultRow } from "pg";

/** Reuse the Pool across hot reloads/serverless invocations */
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

/** Choose pooled URL if available (e.g., Supabase pgbouncer/Neon pooler). */
function getConnectionString(): string {
  const url = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Missing DATABASE_URL (or DATABASE_URL_POOLER)");
  }
  return url;
}

/** Decide whether to require SSL (default true except for localhost). */
function shouldUseSSL(connectionString: string): boolean {
  if (process.env.DB_SSL?.toLowerCase() === "false") return false;
  if (process.env.DB_SSL?.toLowerCase() === "true") return true;
  return !/localhost|127\.0\.0\.1/.test(connectionString);
}

function makePool(): Pool {
  const connectionString = getConnectionString();
  const cfg: PoolConfig = {
    connectionString,
    ssl: shouldUseSSL(connectionString) ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 12_000,
    keepAlive: true,
  };

  const p = new Pool(cfg);

  p.on("connect", (client) => {
    void client
      .query(
        `SET statement_timeout = '15s';
         SET idle_in_transaction_session_timeout = '10s';`
      )
      .catch(() => {});
  });

  p.on("error", (err) => {
    console.error("[pg] idle client error:", err);
  });

  return p;
}

export const pool: Pool = global.__pgPool ?? (global.__pgPool = makePool());

type NodeErr = Error & { code?: string };

/** Transient errors worth retrying. */
function isTransient(err: NodeErr): boolean {
  const pgCodes =  new Set([
    "57P01", // admin_shutdown
    "57P02", // crash_shutdown
    "57P03", // cannot_connect_now
    "53300", // too_many_connections
    "08006", // connection_failure
    "08003", // connection_does_not_exist
    "XX000", // unspecified error (poolers sometimes emit with db_termination)
  ]);
  const nodeCodes = new Set(["ETIMEDOUT", "ECONNRESET", "EPIPE"]);
  if (err.code && (pgCodes.has(err.code) || nodeCodes.has(err.code))) return true;

  const msg = err.message.toLowerCase();
  const looksTerminated =
    msg.includes("db_termination") ||
    msg.includes("terminated") ||
    msg.includes("server closed the connection") ||
    msg.includes("timeout");

  return pgCodes.has(err.code ?? "") || nodeCodes.has((err as { code?: string }).code ?? "") || looksTerminated;
}

/** Exponential backoff: 300ms, 600ms, 1200ms... */
function backoff(n: number): Promise<void> {
  const ms = 300 * 2 ** n;
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Typed query helper.
 * Returns the native pg shape so callers can keep using `result.rows`.
 */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
  attempts = 3
): Promise<QueryResult<T>> {
  let attempt = 0;
  while (true) {
    try {
      const values: unknown[] = Array.from(params); // ← make it mutable
      return await pool.query<T>(text, values);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (attempt + 1 < attempts && isTransient(err)) {
        await backoff(attempt);
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
}