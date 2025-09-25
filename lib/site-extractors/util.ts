// lib/site-extractors/util.ts
import type { Pos } from "./types";

export function normalizePos(raw?: string | null): Pos | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toUpperCase();
  if (s === "DEF" || s === "D/ST" || s === "DST" || s === "DEFENSE") return "DST";
  if (s === "QB" || s === "RB" || s === "WR" || s === "TE" || s === "K") return s;
  return undefined;
}
