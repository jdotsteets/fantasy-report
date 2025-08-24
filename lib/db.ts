// lib/db.ts
import { Pool, QueryResultRow } from "pg";
import dns from "node:dns/promises";

declare global {
  // Keep a singleton pool during dev hot reloads

  var __pgPool__: Pool | undefined;
}

/** Prefer a dedicated pooler URL; fall back to DATABASE_URL if needed. */
const RAW = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL;
if (!RAW) {
  throw new Error("No DATABASE_URL or DATABASE_URL_POOLER is set.");
}

/** Strip ssl params so our Pool options control TLS. */
function sanitizeConn(urlStr: string): string {
  const u = new URL(urlStr);
  u.searchParams.delete("ssl");
  u.searchParams.delete("sslmode");
  return u.toString();
}

const CONNECTION = sanitizeConn(RAW);

// ---- debug: show which host we really use
(() => {
  try {
    const u = new URL(CONNECTION);
    const masked = `${u.protocol}//${u.username}:${u.password ? "****" : ""}@${u.host}${u.pathname}${u.search}`;
    console.log("[DB] Using connection:", masked);
    console.log("[DB] Host:", u.hostname, "Port:", u.port || "(default)");
    dns
      .lookup(u.hostname)
      .then((ip) => console.log("[DB] DNS OK:", ip))
      .catch((e: unknown) =>
        console.error("[DB] DNS ERROR:", (e as { message?: string }).message ?? String(e))
      );
  } catch (e) {
    console.error("[DB] Bad connection string:", e);
  }
})();

function makePool() {
  return new Pool({
    connectionString: CONNECTION,          // <-- single source of truth
    ssl: { rejectUnauthorized: false },    // Supabase Pooler-friendly
    max: Number(process.env.PGPOOL_MAX ?? 5),
    idleTimeoutMillis: Number(process.env.PG_IDLE_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_MS ?? 10_000),
    keepAlive: true,
  });
}

export const pool: Pool = global.__pgPool__ ?? makePool();
if (!global.__pgPool__) global.__pgPool__ = pool;

function isTransient(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = (e.code || "").toString();
  const msg = (e.message || "").toLowerCase();

  // Common transient classes/cases
  if (
    code === "57P01" || // admin_shutdown
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND"
  ) return true;

  return /terminat|timeout|reset|temporar|transient/.test(msg);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Tiny typed query helper with 1 retry on transient failures. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<{ rows: T[] }> {
  const trimmed = text.trim();

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await pool.query<T>(trimmed, params as unknown[]);
      return { rows: res.rows };
    } catch (err) {
      // Structured logging without leaking secrets in SQL
      console.error("[DB ERROR]");
      console.error("Query:", trimmed);
      console.error("Params:", JSON.stringify(params));

      const msg = (err as { message?: string }).message ?? String(err);
      console.error("Error:", msg);

      if (attempt < 2 && isTransient(err)) {
        // quadratic backoff: 200ms, then 800ms (if more attempts added)
        await sleep(200 * attempt * attempt);
        continue;
      }
      throw err;
    }
  }

  // Should never reach here
  throw new Error("Query failed after retries");
}
