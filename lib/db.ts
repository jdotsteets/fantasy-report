// lib/db.ts
import {
  Pool,
  PoolClient,
  QueryConfig,
  QueryResult,
  QueryResultRow, // 👈 import the base row type
} from "pg";

// Reuse a single Pool across HMR / route invocations
declare global {
  // eslint-disable-next-line no-var
  var __PG_POOL__: Pool | undefined;
}

export const pool: Pool =
  global.__PG_POOL__ ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,                      // play nice with pgBouncer
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    keepAlive: true,
    ssl: { rejectUnauthorized: false },
    allowExitOnIdle: true,
  });

if (!global.__PG_POOL__) global.__PG_POOL__ = pool;

// Helper to ensure release() is always called
export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Typed query helper.
 * R = the row shape returned by the query (must extend QueryResultRow).
 */
export async function dbQuery<R extends QueryResultRow = QueryResultRow>(
  text: string | QueryConfig<any[]>,
  params?: any[]
): Promise<QueryResult<R>> {
  return withClient(async (c) => c.query<R>(text as any, params));
}
