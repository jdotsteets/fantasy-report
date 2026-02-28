import { AdminNav } from "@/components/admin/AdminNav";
import { dbQueryRow, dbQueryRows } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

type SocialCountRow = { status: string; n: string };

async function getOpsSnapshot() {
  const [refreshJob, socialCounts, socialDue, socialLastPublished] = await Promise.all([
    dbQueryRow<{
      id: string;
      status: string;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
      last_message: string | null;
      error_detail: string | null;
    }>(
      `select id, status, created_at::text, started_at::text, finished_at::text, last_message, error_detail
         from jobs
        where type = 'ingest'
          and coalesce(params->>'scope', '') = 'allowed'
        order by created_at desc
        limit 1`
    ),
    dbQueryRows<SocialCountRow>(
      `select status, count(*)::text as n
         from social_drafts
        group by status`
    ),
    dbQueryRow<{ due_now: string }>(
      `select count(*)::text as due_now
         from social_drafts
        where platform = 'x'
          and status = 'scheduled'
          and scheduled_for is not null
          and scheduled_for <= now()`
    ),
    dbQueryRow<{ last_published_at: string | null }>(
      `select max(updated_at)::text as last_published_at
         from social_drafts
        where platform = 'x'
          and status = 'published'`
    ),
  ]);

  return {
    now: new Date().toISOString(),
    refreshJob,
    socialByStatus: Object.fromEntries(socialCounts.map((r) => [r.status, Number(r.n)])),
    socialDueNow: Number(socialDue?.due_now ?? "0"),
    socialLastPublishedAt: socialLastPublished?.last_published_at ?? null,
  };
}

export default async function OpsPage() {
  const s = await getOpsSnapshot();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <AdminNav active="ops" />

      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Ops Health</h1>
        <p className="mt-1 text-sm text-zinc-600">Quick pulse on refresh + social automation.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Refresh Pipeline</h2>
          {s.refreshJob ? (
            <ul className="space-y-1 text-sm">
              <li><span className="text-zinc-500">Job ID:</span> {s.refreshJob.id}</li>
              <li><span className="text-zinc-500">Status:</span> {s.refreshJob.status}</li>
              <li><span className="text-zinc-500">Created:</span> {s.refreshJob.created_at}</li>
              <li><span className="text-zinc-500">Finished:</span> {s.refreshJob.finished_at ?? "—"}</li>
              <li><span className="text-zinc-500">Message:</span> {s.refreshJob.last_message ?? "—"}</li>
              {s.refreshJob.error_detail ? (
                <li className="text-red-700"><span className="text-zinc-500">Error:</span> {s.refreshJob.error_detail}</li>
              ) : null}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600">No allowed-scope ingest jobs found yet.</p>
          )}
        </div>

        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Social Automation</h2>
          <ul className="space-y-1 text-sm">
            <li><span className="text-zinc-500">Due now:</span> {s.socialDueNow}</li>
            <li><span className="text-zinc-500">Last published:</span> {s.socialLastPublishedAt ?? "—"}</li>
            <li><span className="text-zinc-500">Counts:</span> {JSON.stringify(s.socialByStatus)}</li>
          </ul>
        </div>
      </section>

      <p className="mt-6 text-xs text-zinc-500">Snapshot at {s.now}</p>
    </main>
  );
}
