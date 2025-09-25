// app/api/admin/source-probe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runProbe, findExistingSourceByUrl } from "@/lib/sources/index";
import type {
  ProbeRequest,
  ProbeResult,
  ProbeMethod,
} from "@/lib/sources/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Small extension for method-scoped preview without changing your shared types */
type MethodPreview = {
  method: ProbeMethod;
  items: Array<{ title: string; url: string }>;
};

type ExtendedProbeResult = ProbeResult & {
  previewsByMethod?: MethodPreview[];
};

type ExtendedProbeRequest = ProbeRequest & {
  method?: ProbeMethod;
  feedUrl?: string | null;
  selector?: string | null;
  adapterKey?: string | null;
};

function unique<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

/**
 * Try to run a "scoped" probe to produce a preview for a given method/choice.
 * If the underlying runProbe doesn't support these overrides in your version,
 * this will catch and return null (keeping behavior backwards-compatible).
 */
async function tryScopedPreview(
  url: string,
  method: ProbeMethod,
  windowHours: number | undefined,
  choices: { feedUrl?: string | null; selector?: string | null; adapterKey?: string | null }
): Promise<MethodPreview | null> {
  try {
    // We optimistically pass optional fields; older runProbe impls may ignore or throw.
    const scoped = await runProbe({
      url,
      windowHours,
      methodOverride: method,      // <-- supported in newer libs; safe to pass
      feedUrl: choices.feedUrl ?? null,
      selector: choices.selector ?? null,
      adapterKey: choices.adapterKey ?? null,
      previewOnly: true,           // hint to avoid heavy work if your lib supports it
    } as unknown as ProbeRequest);  // cast to ProbeRequest for compatibility without using `any`

    const items = (scoped.preview ?? []).map((p) => ({ title: p.title, url: p.url }));
    return { method, items };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ExtendedProbeRequest;
  const url = (body?.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    // 1) Base probe (existing behavior)
    const base = await runProbe({ url, windowHours: body.windowHours });

    // 2) If the caller asked for a specific method, try to re-probe for that preview
    let selectedPreview: MethodPreview | null = null;
    if (body.method) {
      selectedPreview = await tryScopedPreview(url, body.method, body.windowHours, {
        feedUrl: body.feedUrl ?? null,
        selector: body.selector ?? null,
        adapterKey: body.adapterKey ?? null,
      });
    }

    // 3) Build previewsByMethod opportunistically for the strongest candidates we found
    const previewsByMethod: MethodPreview[] = [];
    const wantRss = base.feeds.some((f) => f.ok);
    const wantScrape = base.scrapes.some((s) => s.ok);
    const wantAdapter = base.adapters.some((a) => a.ok);

    const bestFeed = [...base.feeds].filter((f) => f.ok).sort((a, b) => (b.itemCount ?? 0) - (a.itemCount ?? 0))[0];
    const bestSel = [...base.scrapes].filter((s) => s.ok).sort((a, b) => b.linkCount - a.linkCount)[0];
    const bestAdp = [...base.adapters].filter((a) => a.ok).sort((a, b) => (b.itemCount ?? 0) - (a.itemCount ?? 0))[0];

    // Try to gather method-scoped previews (each call is safe-failing)
    const tasks: Array<Promise<MethodPreview | null>> = [];
    if (wantRss && bestFeed) {
      tasks.push(tryScopedPreview(url, "rss", body.windowHours, { feedUrl: bestFeed.feedUrl }));
    }
    if (wantScrape && bestSel) {
      tasks.push(tryScopedPreview(url, "scrape", body.windowHours, { selector: bestSel.selectorTried }));
    }
    if (wantAdapter && bestAdp) {
      tasks.push(tryScopedPreview(url, "adapter", body.windowHours, { adapterKey: bestAdp.key }));
    }

    const scoped = (await Promise.all(tasks)).filter(
      (x): x is MethodPreview => x !== null
    );

    // Ensure uniqueness by method; if a selectedPreview exists, prefer it.
    const merged = unique<MethodPreview>(
      [
        ...(selectedPreview ? [selectedPreview] : []),
        ...scoped,
      ],
      (m) => m.method
    );

    // 4) Existing source lookup (kept as-is)
    const existingSource = await findExistingSourceByUrl(url);

    // 5) Final payload: preserve base result fields; optionally swap preview if user forced a method
    const result: ExtendedProbeResult = {
      ...base,
      preview: selectedPreview?.items ?? base.preview,
      previewsByMethod: merged.length > 0 ? merged : undefined,
      existingSource,
    };

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
