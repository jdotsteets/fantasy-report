// app/api/section/route.ts
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
    const limit = clampInt(url.searchParams.get("limit"), 12, 1, 100);
    const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
    const days = clampInt(url.searchParams.get("days"), 45, 1, 365);
    const weekParam = url.searchParams.get("week");
    const week = weekParam ? clampInt(weekParam, 0, 0, 30) : null;

    const freshHoursParam = url.searchParams.get("freshHours");
    const maxAgeHours = key === "news"
      ? clampInt(freshHoursParam, 72, 1, 24*14)  // default 72h (3 days)
      : undefined; 

    const perProviderCap = clampInt(
      url.searchParams.get("perProviderCap"),
      Math.max(1, Math.floor(limit / 3)),
      1,
      10
    );

    const provider = (url.searchParams.get("provider") || "").trim().toLowerCase();


    const sourceId = url.searchParams.get("sourceId");
    const items = await fetchSectionItems({
      key,
      limit,
      offset,
      days,
      week,
      perProviderCap,
      provider: provider || undefined,
      sourceId: sourceId ? Number(sourceId) : undefined,
      maxAgeHours,
    });

    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
