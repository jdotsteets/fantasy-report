import { Pool, PoolClient, QueryConfig, QueryResult } from "pg";

/** ──────────────────────────────────────────────────────────────────────────
 *  Singleton Pool (works in dev HMR and serverless)
 *  ────────────────────────────────────────────────────────────────────────── */
declare global {
  var __PG_POOL__: Pool | undefined;
}

const pool: Pool =
  global.__PG_POOL__ ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,                       // keep small for serverless / pgBouncer
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    keepAlive: true,
    // Supabase/managed PG often needs rejectUnauthorized:false in prod
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
  console.error("[pg pool error]", (err as { code?: string })?.code, err.message);
});

/** ──────────────────────────────────────────────────────────────────────────
 *  Retry helpers
 *  ────────────────────────────────────────────────────────────────────────── */
type PgErr = { code?: string; message?: string };

function isTransient(err: unknown): boolean {
  const { code, message } = (err ?? {}) as PgErr;
  const msg = (message ?? "").toLowerCase();
  return (
    code === "XX000" || // db_termination
    code === "57P01" || // admin_shutdown
    code === "53300" || // too_many_connections
    msg.includes("connection terminated") ||
    msg.includes("terminating connection") ||
    msg.includes("connection reset") ||
    msg.includes("server closed the connection unexpectedly") ||
    msg.includes("timeout exceeded when trying to connect")
  );
}

function sleep(ms: number) {
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
 *  - No `any` in our code (satisfies @typescript-eslint/no-explicit-any)
 *  - Accepts SQL string + params OR a QueryConfig
 *  ────────────────────────────────────────────────────────────────────────── */
export type SqlParam = string | number | boolean | Date | null | readonly string[];
export type SqlParams = ReadonlyArray<SqlParam>;

export async function dbQuery<R extends Record<string, unknown> = Record<string, unknown>>(
  textOrCfg: string | QueryConfig<SqlParam[]>,
  params?: SqlParams
): Promise<QueryResult<R>> {
  return withClient((c) => {
    if (typeof textOrCfg === "string") {
      // pg typings accept `any[]`; pass our params as unknown[] without using `any` locally
      const values = (params as unknown[] | undefined);
      return c.query<R>(textOrCfg, values);
    }
    return c.query<R>(textOrCfg);
  });
}
