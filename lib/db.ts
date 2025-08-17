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

export type Row = Record<string, unknown>;

export const query = (text: string, params?: unknown[]): Promise<QueryResult<Row>> =>
  pool.query(text, params as any[]);
