// lib/db.ts
import {
  Pool,
  PoolClient,
  QueryConfig,
  QueryResult,
  QueryResultRow,
} from "pg";

declare global {
  var __PG_POOL__: Pool | undefined;
}

// Reuse one Pool across hot reloads / invocations
export const pool: Pool =
  global.__PG_POOL__ ??
  new Pool({
    connectionString: process.env.DATABASE_URL, // Supabase pooler URL
    max: 3,                      // gentle on pgBouncer in serverless
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    ssl: { rejectUnauthorized: false },
    allowExitOnIdle: true,
  });

if (!global.__PG_POOL__) global.__PG_POOL__ = pool;

// Always release the client; set a per-connection statement timeout
export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    // optional but helpful to avoid long-running queries
    await client.query(`SET statement_timeout = '10s'`);
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Typed query helper */
export async function dbQuery<R extends QueryResultRow = QueryResultRow>(
  text: string | QueryConfig<unknown[]>,
  params?: unknown[]
): Promise<QueryResult<R>> {
  return withClient(async (c) => c.query<R>(text as string, params as unknown[] | undefined));
}
