import { NextResponse } from "next/server";
import { fetchSectionItems, SectionKey } from "@/lib/sectionQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

function clampInt(val: string | number | null, def: number, min: number, max: number): number {
  const n = typeof val === "string" ? Number(val) : typeof val === "number" ? val : def;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
function toKey(v: string | null): SectionKey | "" {
  const s = (v || "").toLowerCase().trim();
  const all = ["start-sit","waiver-wire","injury","dfs","rankings","advice","news"] as const;
  return (all as readonly string[]).includes(s) ? (s as SectionKey) : "";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const key = toKey(url.searchParams.get("key"));

    const provider = (url.searchParams.get("provider") || "").trim(); // human label (e.g., "ESPN Fantasy")
    const sourceId = url.searchParams.get("sourceId");
    const hasProviderFilter = Boolean(provider) || Boolean(sourceId);

    // If filtered to a provider, show more rows by default
    const baseLimit = clampInt(url.searchParams.get("limit"), 12, 1, 100);
    const limit = hasProviderFilter ? Math.max(baseLimit, 50) : baseLimit;

    const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
    const days = clampInt(url.searchParams.get("days"), 45, 1, 365);
    const weekParam = url.searchParams.get("week");
    const week = weekParam ? clampInt(weekParam, 0, 0, 30) : null;

    const freshHoursParam = url.searchParams.get("freshHours");
    const maxAgeHours = key === "news"
      ? clampInt(freshHoursParam, 72, 1, 24 * 14)
      : undefined;

    // IMPORTANT: when provider filter is present, completely disable the per-provider cap by sending null
    const perProviderCap = hasProviderFilter
      ? null
      : clampInt(url.searchParams.get("perProviderCap"), Math.max(1, Math.floor(limit / 3)), 1, 10);

    const items = await fetchSectionItems({
      key,
      limit,
      offset,
      days,
      week,
      perProviderCap,            // <-- now number | null
      provider: provider || undefined, // we’ll ILIKE this against sources.provider
      sourceId: sourceId ? Number(sourceId) : undefined,
      maxAgeHours,
    });

    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
