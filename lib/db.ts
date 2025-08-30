// lib/db.ts
// Node runtime only. Reuses a single pg Pool across lambda invocations.

import {
  Pool,
  PoolConfig,
  PoolClient,
  QueryResult,
  QueryResultRow,   // <-- add this
} from "pg";

/** Pick the best connection string available. Prefer a pooled URL if you have one. */
const CONNECTION_STRING =
  process.env.DATABASE_POOL_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL ||
  "";

/** SSL handling: default to enabled for hosted providers unless PGSSL=disable */
const SSL_OPTION =
  (process.env.PGSSL ?? "").toLowerCase() === "disable"
    ? false
    : { rejectUnauthorized: false };

const cfg: PoolConfig = {
  connectionString: CONNECTION_STRING,
  max: Number(process.env.PG_POOL_MAX ?? 5),
  idleTimeoutMillis: Number(process.env.PG_IDLE_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS ?? 5_000),
  keepAlive: true,
  ssl: SSL_OPTION,
};

// Reuse a single Pool for the lifetime of the lambda process
declare global {
  // eslint-disable-next-line no-var
  var __PG_POOL__: Pool | undefined;
}
const pool: Pool = global.__PG_POOL__ ?? new Pool(cfg);
if (!global.__PG_POOL__) {
  global.__PG_POOL__ = pool;
  if (process.env.NODE_ENV !== "production") {
    pool.on("error", (err) => {
      console.warn("[pg] pool error:", err?.message ?? err);
    });
  }
}

/** Minimal typed query helper. */
export async function dbQuery<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
  opts?: { timeoutMs?: number }
): Promise<QueryResult<T>> {
  const timeoutMs = opts?.timeoutMs ?? Number(process.env.PG_QUERY_TIMEOUT_MS ?? 15_000);

  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`pg query timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  const p = (async () => {
    const client = await pool.connect();
    try {
      const res = await client.query<T>(text, params);
      return res;
    } finally {
      client.release();
    }
  })();

  try {
    const result = await Promise.race([p, timeoutPromise]);
    return result as QueryResult<T>;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Use when you need multiple statements on one connection (e.g., transactions). */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Simple health check (good for warming the pool before a heavy request). */
export async function dbPing(): Promise<boolean> {
  try {
    await dbQuery("select 1");
    return true;
  } catch {
    return false;
  }
}

/** Expose the pool if you ever need low-level access. */
export { pool as dbPool };
