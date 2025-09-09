// lib/db.ts
import { Pool, PoolConfig, QueryResult, QueryResultRow } from "pg";

/** Reuse the Pool across hot reloads/serverless invocations. */
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

/** Prefer pooled connection string when available. */
function getConnectionString(): string {
  const url = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL (or DATABASE_URL_POOLER)");
  return url;
}

/** SSL config as in your version (unchanged). */
function getSSLConfig(cs: string): PoolConfig["ssl"] | undefined {
  const dbSSL = process.env.DB_SSL?.toLowerCase();
  if (dbSSL === "false") return undefined;
  if (dbSSL === "true") return { rejectUnauthorized: true };

  let sslmode: string | null = null;
  try {
    const u = new URL(cs);
    sslmode = u.searchParams.get("sslmode");
  } catch {}

  sslmode = (process.env.PGSSLMODE || process.env.DB_SSLMODE || sslmode || "").toLowerCase() || null;

  if (sslmode === "disable") return undefined;
  if (sslmode === "no-verify" || sslmode === "allow" || sslmode === "prefer") {
    return { rejectUnauthorized: false };
  }
  if (sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full") {
    return { rejectUnauthorized: true };
  }

  const isLocal = /(?:^|@)(localhost|127\.0\.0\.1)(?::|\/|$)/i.test(cs);
  if (isLocal) return undefined;

  const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  return isProd ? { rejectUnauthorized: true } : { rejectUnauthorized: false };
}

type PoolConfigExtended = PoolConfig & {
  keepAliveInitialDelayMillis?: number;
  maxUses?: number;
  allowExitOnIdle?: boolean;
};

function makePool(): Pool {
  const connectionString = getConnectionString();

  const cfg: PoolConfigExtended = {
    connectionString,
    ssl: getSSLConfig(connectionString),
    max: Number(process.env.PG_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS ?? 12_000),
    // Hard per-query client timeout to avoid hung requests:
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS ?? 15_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: Number(process.env.PG_KEEPALIVE_DELAY_MS ?? 10_000),
    maxUses: Number(process.env.PG_MAX_USES ?? 7_500),
    allowExitOnIdle: true,
  };

  const p = new Pool(cfg);

  p.on("connect", (client) => {
    void client
      .query(
        `
        SET application_name = 'fantasy-report';
        SET statement_timeout = '15s';
        SET idle_in_transaction_session_timeout = '10s';
        `
      )
      .catch(() => {});
  });

  p.on("error", (err) => {
    const code = (err as { code?: string } | undefined)?.code;
    const msg = String((err as { message?: string } | undefined)?.message ?? "").toLowerCase();

    const benign =
      code === "XX000" ||
      code === "57P01" ||
      /db_termination/.test(msg) ||
      /server closed the connection/i.test(msg) ||
      /terminat/.test(msg);

    if (benign) {
      console.warn("[pg] idle client closed (ignored)", { code });
      return;
    }
    console.error("[pg] pool error", err);
  });

  if ((cfg.ssl as { rejectUnauthorized?: boolean } | undefined)?.rejectUnauthorized === false) {
    console.warn("[pg] SSL: rejectUnauthorized=false (dev-only relaxed TLS)");
  }

  return p;
}

export const pool: Pool = global.__pgPool ?? (global.__pgPool = makePool());

type NodeErr = Error & { code?: string };

/** Transient/connection errors worth retrying. */
function isTransient(err: NodeErr): boolean {
  const pgCodes = new Set([
    "57P01", // admin_shutdown
    "57P02", // crash_shutdown
    "57P03", // cannot_connect_now
    "53300", // too_many_connections
    "08006", // connection_failure
    "08003", // connection_does_not_exist
    "XX000", // unspecified/server terminated
  ]);
  const nodeCodes = new Set(["ETIMEDOUT", "ECONNRESET", "EPIPE"]);
  const msg = (err.message || "").toLowerCase();

  return (
    (err.code !== undefined && (pgCodes.has(err.code) || nodeCodes.has(err.code))) ||
    /db_termination|server closed the connection|timeout/.test(msg) ||
    /connection terminated unexpectedly/.test(msg) ||
    /connection terminated due to connection timeout/.test(msg)
  );
}

/** Exponential backoff with mild jitter: 300ms, 600ms, 1200ms… */
function backoff(n: number): Promise<void> {
  const base = 300 * 2 ** n;
  const jitter = Math.floor(Math.random() * 75);
  return new Promise((r) => setTimeout(r, base + jitter));
}

/** Typed query helper. */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
  attempts = Number(process.env.PG_QUERY_ATTEMPTS ?? 3)
): Promise<QueryResult<T>> {
  let attempt = 0;
  const values: unknown[] = Array.from(params);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await pool.query<T>(text, values);
    } catch (e) {
      const err = e as NodeErr;
      if (attempt + 1 < attempts && isTransient(err)) {
        await backoff(attempt++);
        continue;
      }
      throw err;
    }
  }
}

/** Graceful shutdown helper for tests/scripts. */
export async function closePool(): Promise<void> {
  if (global.__pgPool) {
    await global.__pgPool.end().catch(() => {});
    global.__pgPool = undefined;
  }
}
