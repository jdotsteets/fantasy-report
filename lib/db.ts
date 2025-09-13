// lib/db.ts
// Shared Postgres pool for Next.js (server) with keepalive + sane timeouts.
// - Reuses a single Pool across HMR/SSR
// - Avoids connection storms on serverless
// - Cancels long-running queries server-side
// No `any` types.

import { Pool, type QueryResult, type QueryResultRow } from "pg";

// Reuse a single pool between reloads
// eslint-disable-next-line no-var
declare global { var __pgPool__: Pool | undefined }

const url =
  process.env.DATABASE_URL ??
  process.env.DATABASE_URL_POOLER;

const MAX = Number.parseInt(process.env.PGPOOL_MAX ?? "10", 10);
const IDLE = Number.parseInt(process.env.PG_IDLE_TIMEOUT_MS ?? "30000", 10); // 30s
const ACQUIRE = Number.parseInt(process.env.PG_ACQUIRE_TIMEOUT_MS ?? "8000", 10); // 8s

export const pool: Pool = globalThis.__pgPool__ ?? new Pool({
  connectionString: url,
  max: Number.isFinite(MAX) ? MAX : 10,
  idleTimeoutMillis: Number.isFinite(IDLE) ? IDLE : 30_000,
  connectionTimeoutMillis: Number.isFinite(ACQUIRE) ? ACQUIRE : 8_000,
  keepAlive: true,
  allowExitOnIdle: true,
  ssl: { rejectUnauthorized: false },
});

if (!globalThis.__pgPool__) globalThis.__pgPool__ = pool;

// Set per-connection limits as soon as a client is created
pool.on("connect", (client) => {
  // Cancel statements taking longer than 20s; prevent idle tx from hogging the pool
  void client.query(
    "SET statement_timeout = 20000; SET idle_in_transaction_session_timeout = 5000;"
  );
});

pool.on("error", (err) => {
  // Log and continue — the pool will create a replacement connection on demand
  console.error("[pg] idle client error", err);
});

/**
 * Low-level query that returns the full pg QueryResult<T>.
 * Prefer `dbQueryRows` for most callers.
 */
export async function dbQuery<T extends QueryResultRow>(
  text: string,
  values: ReadonlyArray<unknown> = [],
  label?: string
): Promise<QueryResult<T>> {
  const t0 = Date.now();
  try {
    const res = await pool.query<T>(text, values as unknown[]);
    const ms = Date.now() - t0;
    if (ms > 500) {
      // Keep lightweight perf signal; adjust threshold as needed
      console.log(`[db] slow ${ms}ms ${label ?? text.slice(0, 60).replace(/\s+/g, " ")}…`);
    }
    return res;
  } catch (err) {
    console.error("[db] error", { label: label ?? text.slice(0, 60) });
    throw err;
  }
}

/**
 * Convenience helper that returns just `rows` as T[].
 * Safe to use anywhere that expects an array result.
 */
export async function dbQueryRows<T extends QueryResultRow>(
  text: string,
  values: ReadonlyArray<unknown> = [],
  label?: string
): Promise<T[]> {
  const res = await dbQuery<T>(text, values, label);
  return res.rows;
}

// Optional helper for transactions without leaking clients
export async function withTransaction<R>(fn: (client: PoolClientLike) => Promise<R>): Promise<R> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

// Narrow client surface used in transactions (no `any`)
export type PoolClientLike = {
  query<T extends QueryResultRow>(text: string, values?: ReadonlyArray<unknown>): Promise<QueryResult<T>>;
  release(): void;
};

// Optional alias if you want a clearer name for the full result:
export { dbQuery as dbQueryResult };
