// lib/db.ts
import { Pool, PoolClient, QueryConfig, QueryResult } from "pg";

/** ──────────────────────────────────────────────────────────────────────────
 *  Singleton Pool (works in dev HMR and serverless)
 *  ────────────────────────────────────────────────────────────────────────── */
declare global {
  // eslint-disable-next-line no-var
  var __PG_POOL__: Pool | undefined;
}

const pool: Pool =
  global.__PG_POOL__ ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 8_000),
    keepAlive: true,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : undefined,
    allowExitOnIdle: true,
  });

if (!global.__PG_POOL__) {
  global.__PG_POOL__ = pool;
}

// Don't crash the process on background client errors
pool.on("error", (err) => {
  const code = (err as { code?: string })?.code ?? "unknown";
  // eslint-disable-next-line no-console
  console.error("[pg pool error]", code, err.message);
});

/** ──────────────────────────────────────────────────────────────────────────
 *  Retry helpers
 *  ────────────────────────────────────────────────────────────────────────── */
type PgErr = { code?: string; message?: string };

function isTransient(err: unknown): boolean {
  const { code, message } = (err ?? {}) as PgErr;
  const msg = (message ?? "").toLowerCase();
  return (
    code === "XX000" || // internal_error (often db_termination)
    code === "57P01" || // admin_shutdown
    code === "57P02" || // crash_shutdown
    code === "57P03" || // cannot_connect_now
    code === "53300" || // too_many_connections
    code === "08006" || // connection_failure
    code === "08003" || // connection_does_not_exist
    code === "08000" || // connection_exception
    msg.includes("connection terminated") ||
    msg.includes("terminating connection") ||
    msg.includes("connection reset") ||
    msg.includes("server closed the connection unexpectedly") ||
    msg.includes("timeout exceeded when trying to connect")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run a function with a client, with transient-error retries. */
export async function withClient<T>(
  fn: (c: PoolClient) => Promise<T>,
  opts: { attempts?: number; baseBackoffMs?: number } = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseBackoffMs = opts.baseBackoffMs ?? 300;

  let lastErr: unknown;
  for (let tryNo = 0; tryNo < attempts; tryNo++) {
    try {
      const client = await pool.connect();
      try {
        // Optional: uncomment to fail slow queries fast (server-side timeout)
        // await client.query("SET statement_timeout = 10000");
        return await fn(client);
      } finally {
        client.release();
      }
    } catch (err) {
      lastErr = err;
      if (tryNo < attempts - 1 && isTransient(err)) {
        const backoff = baseBackoffMs * Math.pow(2, tryNo); // 300, 600, 1200…
        // eslint-disable-next-line no-console
        console.warn(
          `[pg retry] transient error (${(err as PgErr)?.code ?? "unknown"}): ${
            (err as PgErr)?.message ?? ""
          } – retrying in ${backoff}ms`
        );
        await sleep(backoff);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

/** ──────────────────────────────────────────────────────────────────────────
 *  dbQuery helper (keeps your existing imports working)
 *  - No `any` types
 *  - Accepts SQL string + params OR a QueryConfig
 *  ────────────────────────────────────────────────────────────────────────── */
export type SqlParam =
  | string
  | number
  | boolean
  | Date
  | null
  | readonly string[]
  | readonly number[]
  | readonly boolean[];
export type SqlParams = ReadonlyArray<SqlParam>;
export type QueryRow = Record<string, unknown>;

export async function dbQuery<R extends QueryRow = QueryRow>(
  textOrCfg: string | QueryConfig<SqlParam[]>,
  params?: SqlParams
): Promise<QueryResult<R>> {
  return withClient((c) => {
    if (typeof textOrCfg === "string") {
      const values = params as SqlParam[] | undefined;
      if (values && values.length > 0) {
        // Use typed overload: query<T, I>(text, values)
        return c.query<R, SqlParam[]>(textOrCfg, values);
      }
      return c.query<R>(textOrCfg);
    }
    // Typed config path
    const cfg = textOrCfg as QueryConfig<SqlParam[]>;
    return c.query<R, SqlParam[]>(cfg);
  });
}
