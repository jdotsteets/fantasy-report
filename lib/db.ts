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

/**
 * Decide SSL behavior using (in order):
 *   1) DB_SSL ('true' | 'false')
 *   2) sslmode in DATABASE_URL or PGSSLMODE/DB_SSLMODE env
 *   3) localhost heuristic (no TLS on localhost by default)
 *   4) NODE_ENV: production => verify; otherwise allow self-signed
 *
 * Notes:
 *   - node-postgres does NOT natively parse sslmode semantics, so we map them.
 *   - rejectUnauthorized:false is DEV-ONLY; Prod stays strict.
 */
function getSSLConfig(cs: string): PoolConfig["ssl"] | undefined {
  // (1) Hard override via DB_SSL
  const dbSSL = process.env.DB_SSL?.toLowerCase();
  if (dbSSL === "false") return undefined;
  if (dbSSL === "true") return { rejectUnauthorized: true };

  // (2) sslmode (URL or env)
  let sslmode: string | null = null;
  try {
    const u = new URL(cs);
    sslmode = u.searchParams.get("sslmode");
  } catch {
    /* ignore parse issues */
  }
  sslmode = (process.env.PGSSLMODE || process.env.DB_SSLMODE || sslmode || "").toLowerCase() || null;

  // Map common sslmode variants to pg SSL config
  // disable         -> no TLS
  // allow/prefer    -> TLS if available; we approximate with TLS w/o verification for dev convenience
  // require         -> TLS w/ verification
  // verify-ca/full  -> TLS w/ verification (you’d supply CA via PGSSLROOTCERT if needed)
  if (sslmode === "disable") return undefined;
  if (sslmode === "no-verify" || sslmode === "allow" || sslmode === "prefer") {
    return { rejectUnauthorized: false };
  }
  if (sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full") {
    return { rejectUnauthorized: true };
  }

  // (3) Localhost heuristic
  const isLocal = /(?:^|@)(localhost|127\.0\.0\.1)(?::|\/|$)/i.test(cs);
  if (isLocal) return undefined;

  // (4) Environment default
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
    max: Number(process.env.PG_MAX ?? 10), // cap concurrency
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS ?? 12_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: Number(process.env.PG_KEEPALIVE_DELAY_MS ?? 10_000),
    maxUses: Number(process.env.PG_MAX_USES ?? 7_500), // rotate long-lived conns
    allowExitOnIdle: true,
  };

  const p = new Pool(cfg);

  // Per-connection session settings (timeouts protect from runaway queries)
  p.on("connect", (client) => {
    void client
      .query(
        `
        SET application_name = 'fantasy-report';
        SET statement_timeout = '15s';
        SET idle_in_transaction_session_timeout = '10s';
        `
      )
      .catch(() => {
        /* best effort */
      });
  });

  // Quiet expected server-initiated closes on *idle* clients (e.g., restarts).
  p.on("error", (err) => {
    const code = (err as { code?: string } | undefined)?.code;
    const msg = String((err as { message?: string } | undefined)?.message ?? "").toLowerCase();

    const benign =
      code === "XX000" || // some poolers emit XX000 for db_termination
      code === "57P01" || // admin_shutdown
      /db_termination/.test(msg) ||
      /server closed the connection/i.test(msg) ||
      /terminat/.test(msg);

    if (benign) {
      console.warn("[pg] idle client closed (ignored)", { code });
      return;
    }
    console.error("[pg] pool error", err);
  });

  // In dev, warn loudly if we’re allowing self-signed TLS (helps avoid surprises)
  if ((cfg.ssl as any)?.rejectUnauthorized === false) {
    // eslint-disable-next-line no-console
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
    /db_termination|server closed the connection|timeout/.test(msg)
  );
}

/** Exponential backoff with mild jitter: 300ms, 600ms, 1200ms… */
function backoff(n: number): Promise<void> {
  const base = 300 * 2 ** n;
  const jitter = Math.floor(Math.random() * 75);
  return new Promise((r) => setTimeout(r, base + jitter));
}

/**
 * Typed query helper.
 * Returns the native pg shape so existing callers can keep using `result.rows`.
 */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
  attempts = Number(process.env.PG_QUERY_ATTEMPTS ?? 3)
): Promise<QueryResult<T>> {
  let attempt = 0;
  // Make params mutable because pg mutates arrays internally in some paths.
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
