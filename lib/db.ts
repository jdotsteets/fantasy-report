// lib/db.ts
import {
  Pool,
  PoolClient,
  QueryConfig,
  QueryResult,
  QueryResultRow,
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
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    keepAlive: true,
    ssl: { rejectUnauthorized: false },
    allowExitOnIdle: true,
  });

if (!global.__PG_POOL__) global.__PG_POOL__ = pool;

// Ensure callers always release the client
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
 * R = row type (must extend QueryResultRow)
 */
export async function dbQuery<R extends QueryResultRow = QueryResultRow>(
  text: string | QueryConfig<unknown[]>,
  params?: unknown[]
): Promise<QueryResult<R>> {
  return withClient(async (c) => c.query<R>(text as string, params as unknown[] | undefined));
}
