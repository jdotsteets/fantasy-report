import { NextRequest, NextResponse } from "next/server";
import { fetchOgImage } from "@/lib/enrich";
import { findArticleImage } from "@/lib/scrape-image";
import { getSafeImageUrl, isLikelyFavicon } from "@/lib/images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  try {
    const og = await fetchOgImage(url).catch(() => null);
    const scraped = await findArticleImage(url).catch(() => null);

    const safeOg = getSafeImageUrl(og);
    const safeScraped = getSafeImageUrl(scraped);

    const finalPick = safeOg && !isLikelyFavicon(safeOg)
      ? safeOg
      : safeScraped && !isLikelyFavicon(safeScraped)
      ? safeScraped
      : null;

    return NextResponse.json({
      url,
      og,
      scraped,
      safeOg,
      safeScraped,
      final: finalPick,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
