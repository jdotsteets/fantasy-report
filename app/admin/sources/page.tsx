// app/admin/sources/page.tsx
import { AdminNav } from "@/components/admin/AdminNav";
import {
  getSourcesHealth,
  type HealthSummary,
} from "@/lib/adminHealth";
import { Suspense } from "react";
import SourcesTable from "@/components/admin/SourcesTable";
import QuickAddSource from "@/components/admin/QuickAddSource";
import RunIngestControls from "@/components/admin/RunIngestControls";
import SourceRowEditor from "@/components/admin/SourceRowEditor";
import { absFetch } from "@/lib/absFetch";
import ProbePanel from "@/components/admin/ProbePanel";
import AttentionTable from "@/components/admin/AttentionTable";
import SourceLevelSummaryTable from "@/components/admin/SourceLevelSummaryTable";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Suggestion text based on status/detail */
function suggestForError(e: {
  lastStatus: number | null;
  lastDetail: string | null;
  rss_url?: string | null;
  homepage_url?: string | null;
}): string {
  const s = e.lastStatus;
  if (s === 404) {
    if (e.homepage_url && !e.rss_url)
      return "No RSS set; add a scrape_selector for homepage.";
    if (e.rss_url)
      return "Feed path changed/removed. Update RSS or add scrape_selector fallback.";
    return "No ingest configured. Add RSS or scrape_selector.";
  }
  if (s === 406) return "Site blocks RSS requests (406). Add scrape_selector fallback.";
  if (s === 403 || s === 401) return "Blocked/unauthorized. Switch to homepage scraping.";
  return e.lastDetail ? e.lastDetail : "Check feed/selector – likely changed.";
}

async function toggleAllowedAction(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  const allowed = formData.get("allowed") === "1";
  await absFetch(
    `${
      process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
    }/api/admin/sources`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, allowed }),
      cache: "no-store",
    }
  ).catch(() => {});
}

function fmt(val: string | null | undefined) {
  if (!val) return "—";
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

async function runIngestAction(formData: FormData) {
  "use server";
  const limit = Number(formData.get("limit")) || 50;
  const includeHealth = !!formData.get("includeHealth");

  const sourceIdRaw = formData.get("sourceId");
  const sourceId =
    typeof sourceIdRaw === "string" && sourceIdRaw.trim() !== ""
      ? Number(sourceIdRaw)
      : undefined;

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const qs = new URLSearchParams();
  if (typeof sourceId === "number" && Number.isFinite(sourceId)) {
    qs.set("sourceId", String(sourceId));
  }

  await absFetch(
    `${base}/api/admin/ingest${qs.size ? `?${qs.toString()}` : ""}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-key": process.env.ADMIN_KEY ?? "",
      },
      body: JSON.stringify({ limit, includeHealth }),
      cache: "no-store",
    }
  ).catch(() => {});
}

export default async function AdminSourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const windowParam =
    (Array.isArray(sp?.window) ? sp?.window?.[0] : sp?.window) || "72";
  const windowHours = Math.max(1, Math.min(Number(windowParam) || 1, 720));
  const windowMs = windowHours * 60 * 60 * 1000;

  // new: sorting & filter controls from query
  const sort = (Array.isArray(sp?.sort) ? sp?.sort[0] : sp?.sort) || "lastAt";
  const dir = ((Array.isArray(sp?.dir) ? sp?.dir[0] : sp?.dir) === "asc" ? "asc" : "desc") as
    | "asc"
    | "desc";
  const hideTeams =
    (Array.isArray(sp?.hideTeams) ? sp?.hideTeams[0] : sp?.hideTeams) === "1" ||
    (Array.isArray(sp?.hideTeams) ? sp?.hideTeams[0] : sp?.hideTeams) === "true";

  const summary = await getSourcesHealth(windowHours);

  // Safer item types
  type PerSourceItem = NonNullable<HealthSummary["perSource"]>[number] & {
    siteMaxPublishedAt?: string | null;
    lastArticleAt?: string | null;
    canSeeSite?: boolean | null;
    via?: string | null;
    category?: string | null;
  };
  type ErrorItem = NonNullable<HealthSummary["errors"]>[number];

  type AttentionRow = {
    id: number;
    source: string;
    status: "ok" | "stale" | "cold" | "error";
    lastDiscovered: string | null;
    articlesInWindow: number;
    totalArticles: number;
    lastStatus: number | null;
    lastDetail: string | null;
    rss_url: string | null;
    homepage_url: string | null;
    allowed: boolean | null;
    category?: string | null;
    suggestion?: string;
  };

  const errorById = new Map<number, ErrorItem>();
  for (const e of (summary.errors ?? []) as ErrorItem[]) {
    errorById.set(e.source_id, e);
  }

  // map id -> category so we can filter teams in the source-level table
  const catById = new Map<number, string | null>();
  for (const p of (summary.perSource ?? []) as PerSourceItem[]) {
    catById.set(p.id, p.category ?? null);
  }

  const STALENESS_TOLERANCE_MS = 5 * 60 * 1000;

  function deriveStatus(s: PerSourceItem, err?: ErrorItem): AttentionRow["status"] {
    if (err?.lastStatus && err.lastStatus >= 400) return "error";
    if (s.canSeeSite === false) return "error";

    const siteMaxTs = s.siteMaxPublishedAt ? Date.parse(s.siteMaxPublishedAt) : 0;
    const dbMaxTs   = s.lastArticleAt       ? Date.parse(s.lastArticleAt)       : 0;

    if (siteMaxTs) {
      if (dbMaxTs && dbMaxTs >= siteMaxTs - STALENESS_TOLERANCE_MS) {
        return "ok";
      } else {
        return "stale";
      }
    }

    const lastSeenTs = s.lastDiscovered ? Date.parse(s.lastDiscovered) : 0;
    const fresh = lastSeenTs && Date.now() - lastSeenTs < windowMs;

    if (s.articlesInWindow > 0 || fresh) return "ok";
    if ((s.totalArticles ?? 0) === 0) return "cold";
    return "stale";
  }

  const attention: AttentionRow[] = (summary.perSource ?? [])
    .filter((s) => (s.allowed ?? true))
    .map((raw) => {
      const s = raw as PerSourceItem;
      const err = errorById.get(s.id);
      const status = deriveStatus(s, err);

      return {
        id: s.id,
        source: s.name ?? `#${s.id}`,
        status,
        lastDiscovered: s.lastDiscovered ?? null,
        articlesInWindow: s.articlesInWindow ?? 0,
        totalArticles: s.totalArticles ?? 0,
        lastStatus: err?.lastStatus ?? null,
        lastDetail: err?.lastDetail ?? null,
        rss_url: err?.rss_url ?? null,
        homepage_url: err?.homepage_url ?? null,
        allowed: (s.allowed ?? true) && (err?.allowed ?? true),
        category: s.category ?? null,
        suggestion:
          status === "error"
            ? suggestForError({
                lastStatus: err?.lastStatus ?? null,
                lastDetail: err?.lastDetail ?? null,
                rss_url: err?.rss_url ?? null,
                homepage_url: err?.homepage_url ?? null,
              })
            : undefined,
      };
    })
    .filter((r) => r.status !== "ok")
    .sort((a, b) => {
      if (a.articlesInWindow !== b.articlesInWindow)
        return a.articlesInWindow - b.articlesInWindow;
      const ad = a.lastDiscovered ? Date.parse(a.lastDiscovered) : 0;
      const bd = b.lastDiscovered ? Date.parse(b.lastDiscovered) : 0;
      if (ad !== bd) return ad - bd;
      const a404 = a.lastStatus === 404 ? 1 : 0;
      const b404 = b.lastStatus === 404 ? 1 : 0;
      return b404 - a404;
    });

  // enrich per-source ingest rows with category for filtering
  const perSourceIngest =
    (summary.perSourceIngest ?? []).map((r) => ({
      ...r,
      category: (r as any).category ?? catById.get(r.source_id) ?? null,
    })) as Array<
      NonNullable<HealthSummary["perSourceIngest"]>[number] & { category?: string | null }
    >;

  return (
    <main className="mx-auto max-w-[1100px] space-y-8 px-4 py-8">
      <AdminNav active="sources" />
      <ProbePanel />

      <h1 className="text-2xl font-bold">Sources Admin</h1>

      <RunIngestControls action={runIngestAction} className="mb-6" />

      {/* Summary */}
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ingestion Summary</h2>
          <form method="GET" className="flex items-center gap-2">
            <label className="text-sm text-zinc-600">Window (hrs)</label>
            <select
              name="window"
              defaultValue={String(windowHours)}
              className="h-8 rounded border px-2 text-sm"
            >
              {[1, 4, 24, 48, 72, 168, 336, 720].map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            {/* preserve sort + filter when changing window */}
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="dir" value={dir} />
            {hideTeams ? <input type="hidden" name="hideTeams" value="1" /> : null}
            <button className="h-8 rounded border px-3 text-sm hover:bg-zinc-50">
              Refresh
            </button>
          </form>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryTile label="Sources pull" value={summary.sourcesPulled} />
          <SummaryTile label="Sources blank" value={summary.sourcesBlank} />
          <SummaryTile label="Inserted" value={summary.insertedTotal ?? 0} />
          <SummaryTile label="Updated" value={summary.updatedTotal ?? 0} />
          <SummaryTile label="Skipped" value={summary.skippedTotal ?? 0} />
          <SummaryTile label="Window (hrs)" value={summary.windowHours} mono />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SummaryTile
            label="Generated"
            value={new Date(summary.generatedAt).toLocaleString()}
            mono
          />
          <SummaryTile
            label="Most recent"
            value={
              summary.mostRecent
                ? new Date(summary.mostRecent).toLocaleString()
                : "—"
            }
            mono
          />
        </div>
      </section>

      {/* Source-level Summary */}
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Source-level Summary (last {summary.windowHours}h)
          </h2>
          {/* Hide-team filter (GET form so we stay SSR) */}
          <form method="GET" className="flex items-center gap-3 text-sm">
            <input type="hidden" name="window" value={String(windowHours)} />
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="dir" value={dir} />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="hideTeams"
                value="1"
                defaultChecked={hideTeams}
              />
              Hide team sources
            </label>
            <button className="h-8 rounded border px-3 hover:bg-zinc-50">Apply</button>
          </form>
        </div>

        <SourceLevelSummaryTable
          rows={perSourceIngest}
          windowHours={summary.windowHours}

        />
        <p className="mt-3 text-xs text-zinc-500">
          Same metrics as the overall summary, broken out by source for this window.
        </p>
      </section>

      {/* Attention Needed */}
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 text-lg font-semibold">Attention Needed</h2>
        {attention.length === 0 ? (
          <div className="rounded border p-3 text-sm text-zinc-600">
            All good. No stale or erroring sources in the last {summary.windowHours} hours.
          </div>
        ) : (
          <AttentionTable rows={attention} />
        )}
        <p className="mt-3 text-xs text-zinc-500">
          Uses site-vs-DB newest-article comparison when available; otherwise falls
          back to window activity. Errors surface HTTP/visibility issues.
        </p>
      </section>

      {/* Existing Sources (editable) */}
      <section id="sources-table" className="rounded-xl border p-4">
        <h2 className="mb-3 text-lg font-semibold">Existing Sources</h2>
        <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading…</div>}>
          <div className="space-y-6">
            <SourceRowEditor />
            <SourcesTable />
          </div>
        </Suspense>
      </section>
    </main>
  );
}

/* small presentational helpers */

function SummaryTile({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="rounded border border-emerald-200 bg-white p-3">
      <div className="text-xs text-emerald-900">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${mono ? "font-mono" : ""}`}>
        {String(value)}
      </div>
    </div>
  );
}

