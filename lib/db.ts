// lib/db.ts
import "server-only";
import { Pool, PoolClient, QueryConfig, QueryResult } from "pg";

/** ──────────────────────────────────────────────────────────────────────────
 *  Singleton Pool (safe with Next.js HMR)
 *  ────────────────────────────────────────────────────────────────────────── */
declare global {
  var __PG_POOL__: Pool | undefined;
  var __PG_POOL_LISTENER_ATTACHED__: boolean | undefined;
}

const CREATED_NEW_POOL = !global.__PG_POOL__;

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

// Attach the error listener **once** to avoid MaxListenersExceededWarning.
if (CREATED_NEW_POOL && !global.__PG_POOL_LISTENER_ATTACHED__) {
  // Optional: disable listener limit entirely (Pool is an EventEmitter at runtime).
  const maybeSetMax = (pool as unknown as {
    setMaxListeners?: (n: number) => void;
  }).setMaxListeners;
  if (typeof maybeSetMax === "function") {
    maybeSetMax.call(pool, 0);
  }

  pool.on("error", (err: unknown) => {
    const e = (err ?? {}) as { code?: string; message?: string };
    const code = e.code ?? "unknown";
    const msg = (e.message ?? "").toLowerCase();

    // Many providers idle/kill connections. These are benign; ignore.
    const benign =
      code === "XX000" ||
      code === "57P01" || // admin_shutdown
      code === "57P02" || // crash_shutdown
      code === "57P03" || // cannot_connect_now
      code === "08006" || // connection_failure
      code === "08003" || // connection_does_not_exist
      msg.includes("connection terminated") ||
      msg.includes("terminating connection") ||
      msg.includes("server closed the connection unexpectedly") ||
      msg.includes("connection reset");

    if (benign) {
      // Uncomment if you want a hint instead of silence:
      // console.warn("[pg pool] benign termination/reset:", code, e.message);
      return;
    }

    // Only log surprising errors loudly.
    console.error("[pg pool error]", code, e.message);
  });

  global.__PG_POOL_LISTENER_ATTACHED__ = true;
}

/** ──────────────────────────────────────────────────────────────────────────
 *  Retry helpers
 *  ────────────────────────────────────────────────────────────────────────── */
type PgErr = { code?: string; message?: string };

function isTransient(err: unknown): boolean {
  const { code, message } = (err ?? {}) as PgErr;
  const msg = (message ?? "").toLowerCase();
  return (
    code === "XX000" || // internal_error (often backend termination)
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
        // Optional: cap statement time
        // await client.query("SET statement_timeout = 10000");
        return await fn(client);
      } finally {
        client.release();
      }
    } catch (err) {
      lastErr = err;
      if (tryNo < attempts - 1 && isTransient(err)) {
        const backoff = baseBackoffMs * 2 ** tryNo; // 300, 600, 1200…
        const code = (err as PgErr)?.code ?? "unknown";
        console.warn(`[pg retry] transient (${code}) – retrying in ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

/** Optional transaction helper. */
export async function dbTx<T>(run: (c: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (c) => {
    await c.query("BEGIN");
    try {
      const out = await run(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      throw e;
    }
  });
}

/** Typed dbQuery that accepts SQL+params or a QueryConfig. */
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
      if (values?.length) {
        return c.query<R, SqlParam[]>(textOrCfg, values);
      }
      return c.query<R>(textOrCfg);
    }
    const cfg = textOrCfg as QueryConfig<SqlParam[]>;
    return c.query<R, SqlParam[]>(cfg);
  });
}

/** Quick health check (handy for debugging). */
export async function dbHealth(): Promise<boolean> {
  try {
    await dbQuery("select 1");
    return true;
  } catch {
    return false;
  }
}
