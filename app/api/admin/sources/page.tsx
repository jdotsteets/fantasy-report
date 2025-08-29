// app/admin/sources/page.tsx
import { Suspense } from "react";
import { revalidatePath } from "next/cache";
import SourcesTable from "@/components/admin/SourcesTable";
import { getSourcesHealth, type HealthSummary } from "@/lib/adminHealth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* tiny date formatter */
function fmt(val: string | null | undefined) {
  if (!val) return "—";
  const d = new Date(val);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/* Run ingest from this page (server action) */
async function runIngestAction(formData: FormData) {
  "use server";
  const limit = Math.max(1, Math.min(Number(formData.get("limit")) || 50, 200));
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  await fetch(`${base}/api/admin?task=ingest&limit=${limit}&includeHealth=1`, {
    method: "POST",
    headers: { "x-admin-key": process.env.ADMIN_KEY ?? "" },
    cache: "no-store",
  }).catch(() => {});
  revalidatePath("/admin/sources");
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminSourcesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const windowParam = (Array.isArray(sp?.window) ? sp?.window?.[0] : sp?.window) || "72";
  const windowHours = Math.max(1, Math.min(Number(windowParam) || 72, 720));

  const summary: HealthSummary = await getSourcesHealth(windowHours);

  const stale = summary.perSource
    .filter((s) => s.status !== "ok" && (s.allowed ?? true))
    // Sort by (a) fewest in-window, then (b) oldest lastDiscovered first
    .sort((a, b) => {
      if (a.articlesInWindow !== b.articlesInWindow)
        return a.articlesInWindow - b.articlesInWindow;
      const ad = a.lastDiscovered ? Date.parse(a.lastDiscovered) : 0;
      const bd = b.lastDiscovered ? Date.parse(b.lastDiscovered) : 0;
      return ad - bd;
    });

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Sources Admin</h1>

      {/* Controls */}
      <form className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-zinc-600">
          Window (hrs)
          <select
            name="window"
            defaultValue={String(windowHours)}
            className="ml-2 h-8 rounded border px-2 text-sm"
          >
            {[24, 48, 72, 168, 336, 720].map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>

        <button className="h-8 rounded border px-3 text-sm hover:bg-zinc-50">Refresh</button>

        <form action={runIngestAction} className="ml-auto flex items-center gap-2">
          <label className="text-sm text-zinc-600">
            Run ingest (limit)
            <input
              name="limit"
              type="number"
              min={1}
              max={200}
              defaultValue={50}
              className="ml-2 h-8 w-20 rounded border px-2 text-sm"
            />
          </label>
          <button
            formAction={runIngestAction}
            className="h-8 rounded bg-emerald-600 px-3 text-sm text-white hover:bg-emerald-700"
          >
            Run
          </button>
        </form>
      </form>

      {/* Ingestion Summary — compact tiles */}
      <section className="rounded-xl border p-4">
          {/* compact, side-by-side tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryTile label="Sources pull"  value={summary.sourcesPulled} />
            <SummaryTile label="Sources blank" value={summary.sourcesBlank} />
            <SummaryTile label="Inserted"      value={summary.insertedTotal ?? 0} />
            <SummaryTile label="Updated"       value={summary.updatedTotal  ?? 0} />
            <SummaryTile label="Skipped"       value={summary.skippedTotal  ?? 0} />
            <SummaryTile label="Window (hrs)"  value={summary.windowHours} mono />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SummaryTile label="Generated"   value={summary.generatedAt} mono />
            <SummaryTile label="Most recent" value={summary.mostRecent ?? "—"} mono />
          </div>
      </section>

      {/* Stale / Cold Sources */}
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 text-lg font-semibold">
          Stale / Cold Sources (last {windowHours}h)
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th>source_id</th>
                <th>source</th>
                <th>in window</th>
                <th>total</th>
                <th>most recent</th>
                <th>oldest</th>
                <th>status</th>
                <th>suggestion</th>
                <th>links</th>
              </tr>
            </thead>
            <tbody>
              {stale.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-zinc-600" colSpan={9}>
                    No stale sources in the last {summary.windowHours} hours.
                  </td>
                </tr>
              ) : (
                stale.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{s.id}</td>
                    <td className="px-3 py-2">{s.name ?? "—"}</td>
                    <td className="px-3 py-2">{s.articlesInWindow}</td>
                    <td className="px-3 py-2">{s.totalArticles}</td>
                    <td className="px-3 py-2">{fmt(s.lastDiscovered)}</td>
                    <td className="px-3 py-2">{fmt(s.firstDiscovered)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          s.status === "cold"
                            ? "rounded bg-zinc-200 px-2 py-0.5 text-zinc-800"
                            : "rounded bg-amber-200 px-2 py-0.5 text-amber-900"
                        }
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{s.suggestion ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        {s.rss_url ? (
                          <a className="text-emerald-700 underline" href={s.rss_url} target="_blank">
                            RSS
                          </a>
                        ) : null}
                        {s.homepage_url ? (
                          <a
                            className="text-emerald-700 underline"
                            href={s.homepage_url}
                            target="_blank"
                          >
                            Homepage
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Tip: if a source is stale and has a <code>homepage_url</code> but no{" "}
          <code>scrape_selector</code>, add a selector (e.g.{" "}
          <code>a[href*="/nfl/"]</code>) so the scraper can backfill when RSS breaks.
        </p>
      </section>

      {/* Existing sources (editable) */}
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 text-lg font-semibold">Existing Sources</h2>
        <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading…</div>}>
          <SourcesTable />
        </Suspense>
      </section>
    </main>
  );
}

/* small presentational tile */
function SummaryTile({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined; // <- allow nullish
  mono?: boolean;
}) {
  // Render nicely:
  const display =
    value == null
      ? "—"
      : typeof value === "string"
      ? fmt(value)              // use your date formatter for strings
      : String(value);          // numbers

  return (
    <div className="rounded border border-emerald-200 bg-white p-3">
      <div className="text-xs text-emerald-900">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${mono ? "font-mono" : ""}`}>
        {display}
      </div>
    </div>
  );
}

