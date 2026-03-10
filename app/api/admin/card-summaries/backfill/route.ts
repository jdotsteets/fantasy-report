import { NextResponse } from "next/server";
import { dbQueryRows } from "@/lib/db";
import { generateCardSummaryForArticle } from "@/lib/agent/cardSummary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    limit?: unknown;
    force?: unknown;
    dryRun?: unknown;
  };
  const limitRaw = typeof body.limit === "number" ? body.limit : Number(body.limit);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 25, 100));
  const force = body.force === true || body.force === "true";
  const dryRun = body.dryRun === true || body.dryRun === "true";

  const where = force
    ? "true"
    : "summary is null or fantasy_impact_label is null or fantasy_impact_confidence is null";

  const rows = await dbQueryRows<{ id: number }>(
    `
    select id
    from articles
    where ${where}
    order by published_at desc nulls last, id desc
    limit $1
    `,
    [limit]
  );

  const results: { id: number; ok: boolean; skipped?: boolean }[] = [];
  for (const r of rows) {
    const id = Number(r.id);
    if (!Number.isFinite(id) || id <= 0) {
      results.push({ id: r.id, ok: false, skipped: true });
      continue;
    }
    if (dryRun) {
      results.push({ id: r.id, ok: true, skipped: true });
      continue;
    }
    const res = await generateCardSummaryForArticle(id, undefined, { force });
    results.push({ id: r.id, ok: res.ok });
  }

  return NextResponse.json({ ok: true, count: results.length, force, dryRun, results });
}
