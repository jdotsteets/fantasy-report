// lib/db.ts
import { Pool, QueryResult } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Create .env.local with your Supabase connection string.");
}

// Reuse a single Pool across hot reloads in dev
const globalForPg = global as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

if (!globalForPg.pgPool) globalForPg.pgPool = pool;

// Acceptable SQL parameter types (recursive arrays allowed)
type SQLPrimitive = string | number | boolean | Date | null | Buffer | Uint8Array;
export type SQLParam = SQLPrimitive | readonly SQLPrimitive[] | readonly SQLParam[];
export type SQLParams = readonly SQLParam[];

export type Row = Record<string, unknown>;

export const query = <T extends Row = Row>(
  text: string,
  params?: SQLParams
): Promise<QueryResult<T>> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pool.query<T>(text, params as unknown as any[]);
};
