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

// Prefer DATABASE_URL; fall back to DATABASE_URL_POOLER for legacy envs
const rawUrl = process.env.DATABASE_URL ?? process.env.DATABASE_URL_POOLER;
if (!rawUrl) throw new Error("Missing DATABASE_URL / DATABASE_URL_POOLER");

// Prefer explicit PGPOOL_MAX, then legacy PG_MAX. Keep default conservative for serverless.
const MAX = Number.parseInt(process.env.PGPOOL_MAX ?? process.env.PG_MAX ?? "3", 10);
const IDLE = Number.parseInt(process.env.PG_IDLE_TIMEOUT_MS ?? "30000", 10); // 30s
const ACQUIRE = Number.parseInt(process.env.PG_ACQUIRE_TIMEOUT_MS ?? "8000", 10); // 8s

// ✅ TLS handling:
// Default: require TLS and accept MITM/self-signed chains (fixes SELF_SIGNED_CERT_IN_CHAIN on corp networks)
// Opt out ONLY by setting PGSSLMODE=disable
const SSL =
  (process.env.PGSSLMODE ?? "").toLowerCase() === "disable"
    ? false
    : { rejectUnauthorized: false };

// IMPORTANT: strip sslmode from URL so pg doesn't override ssl options internally.
function stripSslmode(u: string): string {
  try {
    const x = new URL(u);
    // Remove sslmode if present; we control TLS via `ssl:` option.
    x.searchParams.delete("sslmode");
    // Also remove empty "?" if no params remain
    if ([...x.searchParams.keys()].length === 0) x.search = "";
    return x.toString();
  } catch {
    // Fallback: remove sslmode query param if URL parsing fails
    return u
      .replace(/[?&]sslmode=[^&]+/i, "")
      .replace(/\?$/, "");
  }
}

const url = stripSslmode(rawUrl);

export const pool: Pool =
  globalThis.__pgPool__ ??
  new Pool({
    connectionString: url,
    max: Number.isFinite(MAX) ? MAX : 10,
    idleTimeoutMillis: Number.isFinite(IDLE) ? IDLE : 30_000,
    connectionTimeoutMillis: Number.isFinite(ACQUIRE) ? ACQUIRE : 8_000,
    keepAlive: true,
    allowExitOnIdle: true,
    ssl: SSL,
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
      console.log(
        `[db] slow ${ms}ms ${label ?? text.slice(0, 60).replace(/\s+/g, " ")}…`
      );
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

export async function dbQueryRow<T extends QueryResultRow>(
  text: string,
  values: ReadonlyArray<unknown> = [],
  label?: string
): Promise<T | null> {
  const rows = await dbQueryRows<T>(text, values, label);
  return rows.length > 0 ? rows[0] : null;
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