import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

type ProviderRow = { provider: string | null; source_count: number };

export async function GET() {
// app/api/home/providers/route.ts
const { rows } = await dbQuery<ProviderRow>(`
  SELECT provider, COUNT(*)::int AS source_count
  FROM sources
  WHERE allowed IS TRUE
    AND COALESCE(LOWER(category), '') <> 'team'  -- case + NULL safe
  GROUP BY provider
  ORDER BY provider NULLS LAST
`);

  const providers = rows
    .filter(
      (r): r is { provider: string; source_count: number } =>
        !!r.provider && r.provider.trim() !== ""
    )
    .map((r) => ({ provider: r.provider, count: r.source_count }));

  return NextResponse.json({ providers });
}
