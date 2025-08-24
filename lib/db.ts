// lib/db.ts
import { Pool, QueryResultRow } from "pg";
import dns from "node:dns/promises";


declare global {
  var __pgPool__: Pool | undefined;
}

const raw = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL;
if (!raw) throw new Error("No DATABASE_URL(_POOLER) set");

// Sanitize the URL: remove ssl / sslmode query flags so they don't override our options
function sanitizeConn(urlStr: string): string {
  const u = new URL(urlStr);
  u.searchParams.delete("ssl");
  u.searchParams.delete("sslmode");   // require, verify-full, etc.
  return u.toString();                // no ssl flags in the URL
}

const connectionString = sanitizeConn(raw);

// --- debug: which URL & host are actually used ---
(function debugConnection() {
  try {
    const u = new URL(connectionString);
    const masked = `${u.protocol}//${u.username}:${u.password ? "****" : ""}@${u.host}${u.pathname}${u.search}`;
    console.log("[DB] Using connection:", masked);
    console.log("[DB] Host:", u.hostname, "Port:", u.port || "(default)");
    dns.lookup(u.hostname)
      .then((ip) => console.log("[DB] DNS OK:", ip))
      .catch((e) => console.error("[DB] DNS ERROR:", e.message));
  } catch (e) {
    console.error("[DB] Bad connection string:", e);
  }
})();

export const pool = new Pool({
  connectionString,
  // Force TLS but skip CA verification to avoid “self-signed certificate” from Supabase pooler
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX ?? 5),
  idleTimeoutMillis: Number(process.env.PG_IDLE_MS ?? 10_000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_MS ?? 5_000),
});

if (!global.__pgPool__) global.__pgPool__ = pool;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<{ rows: T[] }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    const res = await pool.query<T>(text, params as unknown[]);
    return { rows: res.rows };
  } catch (err) {
    console.error("[DB ERROR]");
    console.error("Query:", text.trim());
    console.error("Params:", JSON.stringify(params));
    console.error("Error:", err instanceof Error ? err.message : err);
    throw err;
  }
} 
throw new Error("unreachable");
}

