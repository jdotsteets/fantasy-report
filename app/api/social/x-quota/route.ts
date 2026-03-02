import { NextResponse } from "next/server";
import { getFreshXBearer } from "@/app/src/social/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RateInfo = {
  limit: number | null;
  remaining: number | null;
  reset: number | null;            // epoch seconds from X, if present
  resetIso: string | null;         // human-friendly ISO time
  secondsUntilReset: number | null;
  ok: boolean;
  note?: string;
};

function num(h: Headers, key: string): number | null {
  const raw = h.get(key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const bearer = await getFreshXBearer();
  if (!bearer) {
    return NextResponse.json<RateInfo>({ ok: false, limit: null, remaining: null, reset: null, resetIso: null, secondsUntilReset: null, note: "No X bearer" }, { status: 400 });
  }

  // Hit a lightweight authenticated endpoint to read headers.
  // (We use fetch directly so we can access response headers.)
  const resp = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${bearer}` },
    // If your region still uses api.twitter.com, swap the host accordingly.
  });

  const h = resp.headers;
  const limit = num(h, "x-rate-limit-limit");
  const remaining = num(h, "x-rate-limit-remaining");
  const reset = num(h, "x-rate-limit-reset");

  let resetIso: string | null = null;
  let secondsUntilReset: number | null = null;
  if (reset) {
    resetIso = new Date(reset * 1000).toISOString();
    secondsUntilReset = Math.max(0, Math.floor(reset * 1000 - Date.now()) / 1000);
  }

  // Some endpoints don’t return rate headers on success for some tiers.
  // If missing, we still return ok=true with a helpful note.
  const note = (!limit && !remaining && !reset)
    ? "Headers not provided by this endpoint/tier. Try again later or check on a 429 response."
    : undefined;

  // Optional: include minimal body so the endpoint is not cached by proxies
  const body = await resp.json().catch(() => ({}));

  return NextResponse.json<RateInfo & { rawStatus: number }>(
    { ok: resp.ok, limit, remaining, reset, resetIso, secondsUntilReset, note, rawStatus: resp.status },
    { status: 200 }
  );
}
