// lib/db.ts
// Typed, resilient Postgres pool with TLS (no cert verify), retry, and multiple call shapes.

import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import type { QueryConfig as PGQueryConfig } from "pg";

/* ───────────────────────── Types ───────────────────────── */

type DBError = Error & {
  code?: string;
  errno?: number | string;
  detail?: string;
};

type Values = PGQueryConfig["values"];


/* helpers */

function isTemplateStringsArray(x: unknown): x is TemplateStringsArray {
  return Array.isArray(x) && Object.prototype.hasOwnProperty.call(x, "raw");
}

/* ───────────────────────── Pool (singleton) ───────────────────────── */

function makePool(): Pool {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");

  // Sanitize the URL so pg doesn’t sneak in its own ssl behavior.
  const u = new URL(raw);
  // pgbouncer / pooler params can stay, but we strip any sslmode hints.
  u.searchParams.delete("sslmode");        // we'll set ssl explicitly below

  const isVercel = Boolean(process.env.VERCEL);

  const p = new Pool({
    connectionString: u.toString(),
    max: Number(process.env.PG_POOL_MAX ?? (isVercel ? 3 : 10)),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS ?? 5_000),
    keepAlive: true,
    allowExitOnIdle: false,

    // 🔐 Force "no-verify" TLS so self-signed / pooler certs don't explode.
    // (Supabase pooler recommends this for node-postgres.)
    ssl: { rejectUnauthorized: false },
  });

  p.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[pg pool error]", err);
  });

  p.on("connect", (client) => {
    void client
      .query(
        [
          "SET application_name = 'fantasy-report'",
          "SET statement_timeout = 30000",
          "SET idle_in_transaction_session_timeout = 60000",
        ].join("; ")
      )
      .catch(() => {});
  });

  return p;
}


// Global singleton across HMR
const g = globalThis as unknown as { __FR_PG_POOL__?: Pool };
if (!g.__FR_PG_POOL__) g.__FR_PG_POOL__ = makePool();
let pool: Pool = g.__FR_PG_POOL__ as Pool;

/** End the current pool (best-effort) and swap in a fresh one. */
function resetPool(): void {
  const old = pool;
  g.__FR_PG_POOL__ = makePool();
  pool = g.__FR_PG_POOL__!;
  void old.end().catch(() => {});
}

/* ───────────────────────── Query helpers ───────────────────────── */

function fromTemplate(strings: TemplateStringsArray, values: unknown[]) {
  // Build parameterized text: s0 + $1 + s1 + $2 + ...
  let text = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}${strings[i + 1] ?? ""}`;
  }
  return { text, params: values as Values };
}

function isTerminatedConnection(err: DBError): boolean {
  const code = err.code ?? "";
  return (
    code === "57P01" || // admin_shutdown
    code === "57P02" || // crash_shutdown
    code === "57P03" || // cannot_connect_now
    code === "08006" || // connection_failure
    code === "08003" || // connection_does_not_exist
    code === "08000" || // connection_exception
    code === "0A000" || // feature_not_supported (pooler oddities)
    code === "XX000" || // internal_error / db_termination
    (err as { name?: string }).name === "AbortError"
  );
}

/* ───────────────────────── Public API ───────────────────────── */

/** Overload: (text, params?) */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: Values
): Promise<QueryResult<T>>;
/** Overload: ({ text, values }) */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  config: PGQueryConfig
): Promise<QueryResult<T>>;
/** Overload: tagged template */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<QueryResult<T>>;
/** Implementation */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  ...args: unknown[]
): Promise<QueryResult<T>> {
  let text: string;
  let params: Values | undefined;

  if (isTemplateStringsArray(args[0])) {
    const tpl = fromTemplate(args[0], args.slice(1));
    text = tpl.text;
    params = tpl.params;
  } else if (typeof args[0] === "string") {
    text = args[0];
    params = (args[1] as Values) ?? undefined;
  } else {
    const cfg = args[0] as PGQueryConfig;
    text = cfg.text;
    params = cfg.values;
  }

  let attempt = 0;
  const maxAttempts = 3;

  for (;;) {
    try {
      return params ? await pool.query<T>(text, params) : await pool.query<T>(text);
    } catch (e) {
      const err = e as DBError;
      if (isTerminatedConnection(err) && attempt + 1 < maxAttempts) {
        attempt++;
        await new Promise((r) => setTimeout(r, 200 * attempt));
        resetPool();
        continue;
      }
      throw err;
    }
  }
}

/** Borrow a client for multi-step ops (transactions, batches). */
export async function withClient<R>(fn: (client: PoolClient) => Promise<R>): Promise<R> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Getter for tests/metrics. */
export function getPool(): Pool {
  return pool;
}
