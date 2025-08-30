// lib/db.ts
import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

/** Pick the best connection string available (prefer pooled) */
function pickConnectionString(): string {
  return (
    process.env.POSTGRES_URL ||                 // Vercel Postgres (pooled)
    process.env.POSTGRES_URL_POOLING ||         // other providers
    process.env.POSTGRES_PRISMA_URL ||          // non-pooled (fallback)
    process.env.POSTGRES_URL_NON_POOLING ||     // non-pooled (fallback)
    process.env.DATABASE_URL ||                 // generic
    ""
  );
}

/** Build a small, serverless-friendly pool */
function makePool(): Pool {
  const connectionString = pickConnectionString();
  if (!connectionString) {
    // Keep an explicit message in logs if env is missing
    console.warn("[db] No connection string env found.");
  }

  // If your provider requires SSL, do not reject (no CA bundle in serverless)
  const wantSsl =
    (process.env.PGSSLMODE ?? process.env.SSL ?? "require").toLowerCase() !== "disable";

  const cfg: PoolConfig = {
    connectionString,
    max: Number.parseInt(process.env.PG_POOL_MAX ?? "3", 10),
    idleTimeoutMillis: Number.parseInt(process.env.PG_IDLE_TIMEOUT ?? "15000", 10),
    connectionTimeoutMillis: Number.parseInt(process.env.PG_CONNECT_TIMEOUT ?? "7000", 10),
    keepAlive: true,
    ssl: wantSsl ? { rejectUnauthorized: false } : undefined,
    allowExitOnIdle: true,
  };

  const pool = new Pool(cfg);

  // Helpful logs; prevents the process from crashing if a client dies
  pool.on("error", (err) => {
    console.error("[pg pool error]", err);
  });

  return pool;
}

/** Cache the pool across hot reloads / serverless invocations */
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}
function getPool(): Pool {
  if (!global.__pgPool) global.__pgPool = makePool();
  return global.__pgPool;
}

/** Main query helper with per-statement timeout */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  const client = await pool.connect(); // respects connectionTimeoutMillis
  try {
    // Keep statements from hanging the request forever
    const stmtTimeout = Number.parseInt(process.env.PG_STATEMENT_TIMEOUT ?? "8000", 10);
    await client.query(`SET LOCAL statement_timeout = ${stmtTimeout}`);
    return await client.query<T>(text, params as unknown[]);
  } finally {
    client.release();
  }
}

/** Lightweight health probe (never throws; times out quickly) */
export async function dbPing(timeoutMs = 1500): Promise<boolean> {
  try {
    await Promise.race([
      dbQuery("select 1"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("connect timeout")), timeoutMs)),
    ]);
    return true;
  } catch (e) {
    console.warn("[dbPing] failed:", (e as Error).message);
    return false;
  }
}

/** Export in case you need to access the raw pool */
export const dbPool = getPool();
