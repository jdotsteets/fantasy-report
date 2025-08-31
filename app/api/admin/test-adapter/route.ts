// app/api/admin/test-adapter/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { SOURCE_ADAPTERS } from "@/lib/sources";
import { normalizeUrl } from "@/lib/sources/shared";

const bodySchema = z.object({
  scraper_key: z.string().min(1),
  // optional: either test a single article URL...
  url: z.string().url().optional(),
  // ...or list N pages and enrich the first M hits
  pageCount: z.number().int().min(1).max(10).optional().default(2),
  limit: z.number().int().min(1).max(20).optional().default(5),
});

type TestHit = { url: string; title?: string; publishedAt?: string | null };

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = bodySchema.parse(raw);

    const key = body.scraper_key.trim().toLowerCase();
    const adapter = SOURCE_ADAPTERS[key];
    if (!adapter) {
      return NextResponse.json(
        { ok: false, error: `No adapter registered for '${key}'` },
        { status: 404 }
      );
    }

    // Mode A: enrich a single URL
    if (body.url) {
      const meta = await adapter.getArticle(normalizeUrl(body.url));
      const sample: TestHit[] = [
        { url: meta.url, title: meta.title, publishedAt: meta.publishedAt ?? null },
      ];
      return NextResponse.json({
        ok: true,
        mode: "single",
        sampleCount: sample.length,
        sample,
      });
    }

    // Mode B: list and sample-enrich some hits
    const hits = await adapter.getIndex(body.pageCount); // one arg only
    const sample: TestHit[] = [];
    for (const h of hits.slice(0, body.limit)) {
      try {
        const meta = await adapter.getArticle(normalizeUrl(h.url)); // one arg only
        sample.push({
          url: meta.url,
          title: meta.title,
          publishedAt: meta.publishedAt ?? null,
        });
      } catch {
        // skip bad ones to let the UI see others
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "index",
      totalFound: hits.length,
      sampleCount: sample.length,
      sample,
    });
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join(", ")
        : err instanceof Error
        ? err.message
        : "unknown_error";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
