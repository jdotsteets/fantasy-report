// app/api/social/publish-thread/[section]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchSectionItems, type SectionKey } from "@/lib/sectionQuery";
import { buildThread } from "@/lib/social/threadBuilder";
import { postThread, postRoot, postReplies } from "@/lib/social/x";

export type XPost = { text: string };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────────────── Types/consts ───────────────────────── */

type Params = { section: string };
type AllowedSection = Extract<SectionKey, "waiver-wire" | "start-sit">;

const LIMIT_MIN = 1;
const LIMIT_MAX = 10;
const DEFAULT_LIMIT = 5;
const DEFAULT_DAYS = 21;
const DEFAULT_PER_PROVIDER_CAP = 3;

// sensible retry defaults for X API
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_BASE_BACKOFF_MS = 15_000;
const DEFAULT_MAX_BACKOFF_MS = 180_000;
const DEFAULT_JITTER_PCT = 0.2;

/* ───────────────────────── Helpers ───────────────────────── */

function toSectionKey(s: string): AllowedSection | null {
  return s === "waiver-wire" || s === "start-sit" ? s : null;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function parseIntOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: string | null): boolean {
  return v === "1" || v === "true";
}

/** Accepts either a plain string or { text } and returns a proper XPost. */
function toXPost(p: string | { text: string }): XPost {
  return typeof p === "string" ? { text: p } : { text: p.text };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function withJitter(baseMs: number, jitterPct: number): number {
  const spread = baseMs * Math.max(0, Math.min(jitterPct, 1));
  const delta = (Math.random() * 2 - 1) * spread; // +/- spread
  return Math.max(0, Math.round(baseMs + delta));
}

type HttpishError = {
  status?: number;
  headers?: Record<string, string> | Map<string, string>;
  message?: string;
  name?: string;
};

function isHttpishError(err: unknown): err is HttpishError {
  if (!err || typeof err !== "object") return false;
  const maybe = err as Record<string, unknown>;
  return (
    "status" in maybe ||
    "headers" in maybe ||
    "message" in maybe ||
    "name" in maybe
  );
}

function parseRateLimitResetMs(err: HttpishError): number | null {
  // Try to honor X headers if your client bubbles them up.
  const hdrs = err.headers;
  if (!hdrs) return null;

  const get = (k: string): string | null => {
    if (hdrs instanceof Map) return hdrs.get(k) ?? null;
    const lowerKey = Object.keys(hdrs).find((h) => h.toLowerCase() === k.toLowerCase());
    return lowerKey ? (hdrs as Record<string, string>)[lowerKey] ?? null : null;
  };

  // X rate headers vary; try common ones
  const reset = get("x-rate-limit-reset");
  if (reset) {
    // Some libs provide epoch seconds, others ms; handle both
    const n = Number(reset);
    if (Number.isFinite(n)) {
      if (n > 10_000_000_000) return Math.max(0, n - Date.now()); // looks like ms epoch
      const targetMs = n * 1000;
      return Math.max(0, targetMs - Date.now());
    }
  }

  // Retry-After (seconds)
  const ra = get("retry-after");
  if (ra) {
    const n = Number(ra);
    if (Number.isFinite(n)) return Math.max(0, n * 1000);
  }

  return null;
}

async function retryOn429<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
    jitterPct: number;
  }
): Promise<T> {
  const { attempts, baseBackoffMs, maxBackoffMs, jitterPct } = opts;
  let backoff = baseBackoffMs;

  for (let i = 0; i < Math.max(1, attempts); i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const httpish = isHttpishError(err) ? err : undefined;
      const status = httpish?.status ?? 0;

      // Only retry on 429; everything else bubble up immediately
      if (status !== 429 || i === attempts - 1) {
        throw err;
      }

      // If headers indicate a reset, honor it (plus small jitter)
      const resetMs = httpish ? parseRateLimitResetMs(httpish) : null;
      const waitMs = resetMs !== null ? resetMs + withJitter(1000, 0.5) : withJitter(backoff, jitterPct);

      await sleep(Math.min(waitMs, maxBackoffMs));

      // Exponential-ish backoff for the next loop
      backoff = Math.min(backoff * 2, maxBackoffMs);
    }
  }

  // Should be unreachable because we either return or throw above
  // but TypeScript wants a return.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw new Error("Exhausted retries without success.");
}

/* ───────────────────────── Route ───────────────────────── */

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { section } = await ctx.params;
  const key = toSectionKey(section);
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "Unsupported section. Use 'waiver-wire' or 'start-sit'." },
      { status: 400 }
    );
  }

  const url = new URL(req.url);

  const limitRaw = parseIntOrNull(url.searchParams.get("limit"));
  const limit = clampInt(limitRaw ?? DEFAULT_LIMIT, LIMIT_MIN, LIMIT_MAX);

  const dry = parseBool(url.searchParams.get("dry"));
  const mode = (url.searchParams.get("mode") ?? "").toLowerCase(); // "", "root", "replies"

  const week = parseIntOrNull(url.searchParams.get("week"));
  const days = clampInt(parseIntOrNull(url.searchParams.get("days")) ?? DEFAULT_DAYS, 1, 60);
  const perProviderCap = clampInt(
    parseIntOrNull(url.searchParams.get("perProviderCap")) ?? DEFAULT_PER_PROVIDER_CAP,
    1,
    10
  );

  const paceMsParam = Number(url.searchParams.get("paceMs") ?? "");
  const paceMs = Number.isFinite(paceMsParam) ? Math.max(0, paceMsParam) : undefined;

  const sport = (url.searchParams.get("sport") ?? "nfl").toLowerCase();

  // Retry tuning (optional query params)
  const attempts = clampInt(parseIntOrNull(url.searchParams.get("attempts")) ?? DEFAULT_ATTEMPTS, 1, 8);
  const baseBackoffMs = Math.max(
    0,
    parseIntOrNull(url.searchParams.get("baseBackoffMs")) ?? DEFAULT_BASE_BACKOFF_MS
  );
  const maxBackoffMs = Math.max(
    baseBackoffMs,
    parseIntOrNull(url.searchParams.get("maxBackoffMs")) ?? DEFAULT_MAX_BACKOFF_MS
  );
  const jitterPctParam = Number(url.searchParams.get("jitterPct") ?? "");
  const jitterPct = Number.isFinite(jitterPctParam) ? Math.max(0, Math.min(1, jitterPctParam)) : DEFAULT_JITTER_PCT;

  // Fetch items for the thread
  let rows;
  try {
    rows = await fetchSectionItems({
      key,
      limit,
      offset: 0,
      days,
      week: week ?? null,
      staticMode: "exclude",
      perProviderCap,
      sport,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Fetch failed", detail: String(err) },
      { status: 502 }
    );
  }

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "No items found for section." }, { status: 404 });
  }

  // Build thread (string[] or {text}[]) → normalize to XPost[]
  const built = buildThread({ section: key, weekHint: week ?? null, maxItems: limit }, rows) as Array<
    string | { text: string }
  >;
  const xPosts: XPost[] = built.map(toXPost);

  // Dry preview: return immediately with composed posts
  if (dry) {
    return NextResponse.json({
      ok: true,
      section: key,
      week,
      days,
      perProviderCap,
      count: xPosts.length,
      postedIds: [],
      dry: true,
      preview: xPosts,
    });
  }

  try {
    // Two-step modes to avoid timeouts or rate limits
    if (mode === "root") {
      if (xPosts.length === 0) {
        return NextResponse.json({ ok: false, error: "Nothing to post." }, { status: 400 });
      }

      const { id } = await retryOn429(
        () => postRoot(xPosts[0].text, { dry: false }),
        { attempts, baseBackoffMs, maxBackoffMs, jitterPct }
      );

      return NextResponse.json({
        ok: true,
        section: key,
        week,
        days,
        perProviderCap,
        rootId: id,
        count: 1,
        dry: false,
      });
    }

    if (mode === "replies") {
      const rootId = url.searchParams.get("rootId") ?? "";
      if (!rootId) {
        return NextResponse.json({ ok: false, error: "Missing rootId for replies." }, { status: 400 });
      }
      const replies = xPosts.slice(1);
      if (replies.length === 0) {
        return NextResponse.json({ ok: true, section: key, week, rootId, postedIds: [], dry: false });
      }

      const result = await retryOn429(
        () => postReplies(replies, rootId, { dry: false, paceMs }),
        { attempts, baseBackoffMs, maxBackoffMs, jitterPct }
      );

      return NextResponse.json({
        ok: true,
        section: key,
        week,
        days,
        perProviderCap,
        rootId,
        postedIds: result.ids,
        dry: false,
      });
    }

    // Default: one-shot post (fast by default; pace if provided)
    const result = await retryOn429(
      () => postThread(xPosts, { dry: false, paceMs }),
      { attempts, baseBackoffMs, maxBackoffMs, jitterPct }
    );

    return NextResponse.json({
      ok: true,
      section: key,
      week,
      days,
      perProviderCap,
      count: xPosts.length,
      postedIds: result.ids,
      dry: false,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Post failed", detail: String(err), preview: xPosts },
      { status: isHttpishError(err) && err.status && err.status >= 400 && err.status < 600 ? err.status : 500 }
    );
  }
}

/** Convenience GET to preview (forces dry-run). */
export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const u = new URL(req.url);
  u.searchParams.set("dry", "1");
  const replay = new NextRequest(u.toString(), { method: "POST", headers: req.headers });
  return POST(replay, ctx);
}
