// app/admin/sources/page.tsx
import { AdminNav } from "@/components/admin/AdminNav";            // <-- same nav used on /admin/excluded
import { getSourcesHealth, type HealthSummary, type SourceHealth } from "@/lib/adminHealth";
          // your health query helper
import { Suspense } from "react";
import SourcesTable from "@/components/admin/SourcesTable";        // <-- NEW client component (next block)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



/* Suggestion text based on status/detail */
function suggestForError(e: { lastStatus: number | null; lastDetail: string | null; rss_url?: string | null; homepage_url?: string | null; }): string {
  const s = e.lastStatus;
  if (s === 404) {
    if (e.homepage_url && !e.rss_url) return "No RSS set; add a scrape_selector for homepage.";
    if (e.rss_url) return "Feed path changed/removed. Update RSS or add scrape_selector fallback.";
    return "No ingest configured. Add RSS or scrape_selector.";
  }
  if (s === 406) return "Site blocks RSS requests (406). Add scrape_selector fallback.";
  if (s === 403 || s === 401) return "Blocked/unauthorized. Switch to homepage scraping.";
  return e.lastDetail ? e.lastDetail : "Check feed/selector – likely changed.";
}

/* server action: enable/disable a source quickly */
async function toggleAllowedAction(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  const allowed = formData.get("allowed") === "1";
  await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/admin/sources`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, allowed }),
    cache: "no-store",
  }).catch(() => {});
}


// tiny date formatter (used by SummaryTile & the table)
function fmt(val: string | null | undefined) {
  if (!val) return "—";
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default async function AdminSourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const windowParam =
    (Array.isArray(sp?.window) ? sp?.window?.[0] : sp?.window) || "72";
  const windowHours = Math.max(1, Math.min(Number(windowParam) || 72, 720));

  const summary = await getSourcesHealth(windowHours);

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 space-y-8">
      {/* Admin nav (links to Sources / Excluded / etc.) */}
      <AdminNav active="sources" />

      <h1 className="text-2xl font-bold">Sources Admin</h1>

      {/* ── Ingestion Summary (top) ───────────────────────────────────── */}
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
              {[24, 48, 72, 168, 336, 720].map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <button className="h-8 rounded border px-3 text-sm hover:bg-zinc-50">
              Refresh
            </button>
          </form>
        </div>

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

      {/* ── Stale / Cold Sources (table) ──────────────────────────────── */}
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 text-lg font-semibold">Stale / Cold Sources (last {windowHours}h)</h2>
        <div className="overflow-x-auto">
          <StaleSourcesTable summary={summary} />
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Tip: if a source is stale and has a <code>homepage_url</code> but no{" "}
          <code>scrape_selector</code>, add a selector (e.g.{" "}
          <code>a[href*=&quot;/nfl/&quot;]</code>) so the scraper can backfill when RSS breaks.
        </p>
      </section>

      {summary.errors && summary.errors.length > 0 && (
        <section className="rounded-xl border p-4">
          <h2 className="mb-3 text-lg font-semibold">Recent Ingest Errors (last {summary.windowHours}h)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                  <th>source</th>
                  <th>errors</th>
                  <th>last seen</th>
                  <th>status</th>
                  <th>why / suggestion</th>
                  <th>links</th>
                  <th>quick fix</th>
                </tr>
              </thead>
              <tbody>
                {summary.errors
                  // put 404s first
                  .sort((a, b) => (Number(b.lastStatus === 404) - Number(a.lastStatus === 404)) || (Date.parse(b.lastAt) - Date.parse(a.lastAt)))
                  .map((e) => {
                    const is404 = e.lastStatus === 404;
                    const why = suggestForError(e);
                    return (
                      <tr key={e.source_id} className={`border-t ${is404 ? "bg-rose-50" : ""}`}>
                        <td className="px-3 py-2">
                          <a href={`/admin/sources#source-${e.source_id}`} className="text-emerald-700 underline">{e.source}</a>
                          {!e.allowed ? <span className="ml-2 rounded bg-zinc-200 px-1.5 text-xs text-zinc-700">disabled</span> : null}
                        </td>
                        <td className="px-3 py-2">{e.total}</td>
                        <td className="px-3 py-2">{new Date(e.lastAt).toLocaleString()}</td>
                        <td className="px-3 py-2">{e.lastStatus ?? "—"}</td>
                        <td className="px-3 py-2">{why}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {e.sampleUrl ? (
                              <a className="text-blue-700 underline" href={e.sampleUrl} target="_blank" rel="noreferrer">sample</a>
                            ) : null}
                            {e.rss_url ? (
                              <a className="text-blue-700 underline" href={e.rss_url} target="_blank" rel="noreferrer">rss</a>
                            ) : null}
                            {e.homepage_url ? (
                              <a className="text-blue-700 underline" href={e.homepage_url} target="_blank" rel="noreferrer">homepage</a>
                            ) : null}
                            <a className="text-blue-700 underline" href={`#source-${e.source_id}`}>edit</a>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <form action={toggleAllowedAction}>
                            <input type="hidden" name="id" value={String(e.source_id)} />
                            <input type="hidden" name="allowed" value={e.allowed ? "0" : "1"} />
                            <button className="rounded border px-2 py-1 text-xs hover:bg-zinc-50">
                              {e.allowed ? "Disable" : "Enable"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Errors (last N hours) */}
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 text-lg font-semibold">Errors (last {summary.windowHours}h)</h2>
        <ErrorsTable errors={summary.errors ?? []} windowHours={summary.windowHours} />
        <p className="mt-3 text-xs text-zinc-500">
          Tip: click <b>Edit</b> to open the source editor below. For 404/410, update the RSS URL
          or add a <code>scrape_selector</code> on a stable list page (e.g.{" "}
          <code>a[href*="/nfl/"]</code>).
        </p>
      </section>


      {/* ── Existing Sources (editable) ───────────────────────────────── */}
      <section id="sources-table" className="rounded-xl border p-4">
        <h2 className="mb-3 text-lg font-semibold">Existing Sources</h2>
        <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading…</div>}>
          <SourcesTable />
        </Suspense>
      </section>
    </main>
  );
}

/* small server-only helpers (presentational) */

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

function StaleSourcesTable({ summary }: { summary: HealthSummary }) {
  // derive stale/cold from perSource
  const rows: SourceHealth[] = summary.perSource
    .filter((s) => s.status !== "ok" && (s.allowed ?? true))
    .sort((a, b) => {
      // fewest in-window first
      if (a.articlesInWindow !== b.articlesInWindow) {
        return a.articlesInWindow - b.articlesInWindow;
      }
      // then oldest lastDiscovered first
      const ad = a.lastDiscovered ? Date.parse(a.lastDiscovered) : 0;
      const bd = b.lastDiscovered ? Date.parse(b.lastDiscovered) : 0;
      return ad - bd;
    });

  if (rows.length === 0) {
    return (
      <div className="rounded border p-3 text-sm text-zinc-600">
        No stale sources in the last {summary.windowHours} hours.
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
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
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
            <td className="px-3 py-2">{r.name ?? "—"}</td>
            <td className="px-3 py-2">{r.articlesInWindow}</td>
            <td className="px-3 py-2">{r.totalArticles}</td>
            <td className="px-3 py-2">{fmt(r.lastDiscovered)}</td>
            <td className="px-3 py-2">{fmt(r.firstDiscovered)}</td>
            <td className="px-3 py-2">{r.status}</td>
            <td className="px-3 py-2">{r.suggestion ?? "—"}</td>
            <td className="px-3 py-2">
              {r.homepage_url ? (
                <a
                  href={r.homepage_url}
                  target="_blank"
                  className="text-blue-700 hover:underline"
                >
                  homepage
                </a>
              ) : (
                "—"
              )}
              {r.rss_url ? (
                <>
                  {" · "}
                  <a
                    href={r.rss_url}
                    target="_blank"
                    className="text-blue-700 hover:underline"
                  >
                    rss
                  </a>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}


/* ───────────────────────── Errors table ───────────────────────── */

function statusHint(status: number | null, detail: string | null): string {
  if (!status && !detail) return "Unknown error—open the sample URL to inspect.";
  if (status === 404 || status === 410) return "Broken feed/page. Update RSS or add a scrape_selector.";
  if (status === 406) return "Not acceptable from this origin—site likely blocks RSS. Prefer scraping.";
  if (status === 403) return "Forbidden—blocked by origin. Switch to scraping or adjust headers.";
  if (status === 429) return "Rate limited—reduce frequency / add backoff.";
  if (status && status >= 500) return "Upstream server error—usually transient.";
  if (detail?.toLowerCase().includes("invalid") || detail?.toLowerCase().includes("parse"))
    return "Parsing error—malformed XML/HTML. Try scraping a stable list page.";
  return "Check feed/selector—likely changed.";
}

function ErrorsTable({
  errors,
  windowHours,
}: {
  errors: NonNullable<HealthSummary["errors"]>;
  windowHours: number;
}) {
  if (!errors || errors.length === 0) {
    return (
      <div className="rounded border p-3 text-sm text-zinc-600">
        No ingest errors in the last {windowHours} hours.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
            <th>source_id</th>
            <th>source</th>
            <th>last error</th>
            <th>total</th>
            <th>when</th>
            <th>links</th>
            <th>recommendation</th>
            <th>fix</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e) => (
            <tr key={e.source_id} className="border-t">
              <td className="px-3 py-2 font-mono text-xs">{e.source_id}</td>
              <td className="px-3 py-2">{e.source}</td>
              <td className="px-3 py-2">
                {e.lastStatus ? (
                  <span className="font-mono">{e.lastStatus}</span>
                ) : (
                  "—"
                )}
                {e.lastDetail ? <span className="text-zinc-600"> — {e.lastDetail}</span> : null}
              </td>
              <td className="px-3 py-2">{e.total}</td>
              <td className="px-3 py-2">{fmt(e.lastAt)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  {e.sampleUrl ? (
                    <a className="text-emerald-700 underline" href={e.sampleUrl} target="_blank">
                      sample
                    </a>
                  ) : null}
                  {e.rss_url ? (
                    <a className="text-emerald-700 underline" href={e.rss_url} target="_blank">
                      rss
                    </a>
                  ) : null}
                  {e.homepage_url ? (
                    <a className="text-emerald-700 underline" href={e.homepage_url} target="_blank">
                      homepage
                    </a>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2">{statusHint(e.lastStatus, e.lastDetail)}</td>
              <td className="px-3 py-2">
                <a className="rounded border px-2 py-1 hover:bg-zinc-50" href={`#sources-table`}>
                  Edit
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
