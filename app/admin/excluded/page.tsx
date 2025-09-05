// app/admin/excluded/page.tsx
import Link from "next/link";
import {
  getExcludedItems,
  type ExcludedRow,
  getIngestLogs,
  type IngestLogRow,
} from "@/lib/excludedData";
import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PendingFieldset, RunIngestButton } from "@/components/admin/RunIngestControls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { absFetch } from "@/lib/absFetch"; // ✅ adjust path if lib/absFetch.ts is under app/lib
// app/admin/excluded/page.tsx (or wherever your admin page is)
import JobRunner from "@/components/admin/JobRunner";
import { headers } from "next/headers";



/* ───────────────────────── Server Actions ───────────────────────── */
async function runIngest(formData: FormData) {
  "use server";

  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    console.error("[/admin/excluded] Missing ADMIN_KEY env var");
    revalidatePath("/admin/excluded");
    return;
  }

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    process.env.VERCEL_URL ??
    "localhost:3000";
  const base = `${proto}://${host}`;

  const sourceIdStr = (formData.get("sourceId") as string | null) ?? null;
  const limitStr = (formData.get("limit") as string | null) ?? null;

  const payload: { sourceId?: number; limit?: number } = {};
  if (sourceIdStr && /^\d+$/.test(sourceIdStr)) payload.sourceId = Number(sourceIdStr);
  if (limitStr && /^\d+$/.test(limitStr)) payload.limit = Number(limitStr);

  try {
    await absFetch(`${base}/api/admin/ingest`, {
      method: "POST",
      headers: {
        "x-admin-key": adminKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[/admin/excluded] ingest POST failed:", e);
  }

  redirect("/admin/excluded?notice=" + encodeURIComponent("Ingest triggered."));
}

async function runBackfill(formData: FormData) {
  "use server";

  const envSecret = process.env.CRON_SECRET;
  if (!envSecret) {
    console.error("[/admin/excluded] Missing CRON_SECRET env var");
    redirect("/admin/excluded?notice=" + encodeURIComponent("CRON_SECRET is not set"));
    return; // helps TS understand nothing below runs without a secret
  }
  const secret: string = envSecret; // now typed as string

  const h = await nextHeaders();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? process.env.VERCEL_URL ?? "localhost:3000";
  const base = `${proto}://${host}`;

  const batch  = Number((formData.get("batch")  as string) || 500);
  const fromId = Number((formData.get("fromId") as string) || 0);
  const dryRun = (formData.get("dryRun") as string | null) === "on";
  const debug  = (formData.get("debug") as string | null) === "on";

  const qs = new URLSearchParams({
    key: secret,                 // legacy GET support
    batch: String(batch),
    fromId: String(fromId),
    dryRun: dryRun ? "1" : "0",
    debug:  debug  ? "1" : "0",
  });

  const url = `${base}/api/backfill-classify?${qs.toString()}`;

  // --- Build typed headers safely
  const buildHeaders = (isPost = false): Headers => {
    const hd = new Headers();
    if (isPost) hd.set("content-type", "application/json");
    hd.set("authorization", `Bearer ${secret}`);
    hd.set("x-cron-key", secret);
    return hd;
  };

  // --- timeout + retries
  async function requestWithRetries(): Promise<{ ok: boolean; status: number; text: string }> {
    let last = { ok: false, status: 0, text: "" };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 20_000);
      try {
        // Try POST first
        let res = await fetch(url, {
          method: "POST",
          headers: buildHeaders(true),
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({}),
        });

        // Fallback to GET if server only allows GET
        if (res.status === 405) {
          res = await fetch(url, {
            method: "GET",
            headers: buildHeaders(false),
            cache: "no-store",
            signal: controller.signal,
          });
        }

        const text = await res.text();
        clearTimeout(t);
        last = { ok: res.ok, status: res.status, text };

        if (res.ok || (res.status >= 400 && res.status < 500)) return last;
        await new Promise(r => setTimeout(r, attempt * 400));
      } catch {
        clearTimeout(t);
        await new Promise(r => setTimeout(r, attempt * 400));
      }
    }
    return last;
  }

  let notice = "Backfill started.";
  const result = await requestWithRetries();

  if (!result.ok) {
    const snippet = result.text ? ` – ${result.text.slice(0, 200)}` : "";
    notice = `Backfill failed: HTTP ${result.status || "???"}${snippet}`;
    return redirect("/admin/excluded?notice=" + encodeURIComponent(notice));
  }

  let data: any = null;
  try { data = result.text ? JSON.parse(result.text) : null; } catch {}

  const processed =
    data?.scanned ?? data?.processed ?? data?.count ?? 0;
  const updatedTopics = data?.updatedTopics ?? 0;
  const updatedStatic = data?.updatedStatic ?? 0;
  const updated = (updatedTopics + updatedStatic) || data?.updated || 0;
  const wasDry = data?.params?.dryRun ?? data?.dryRun ?? dryRun;

  notice =
    `Backfill ${wasDry ? "(dry-run) " : ""}ok – scanned ${processed}, updated ${updated}` +
    (updatedTopics || updatedStatic ? ` (topics: ${updatedTopics}, static: ${updatedStatic})` : "") +
    ".";

  redirect("/admin/excluded?notice=" + encodeURIComponent(notice));
}

/* ───────────────────────── Labels & Utils ──────────────────────── */
const REASON_LABEL: Record<string, string> = {
  player_page: "Player page",
  nbc_non_nfl: "NBC non-NFL path",
  fp_player_util: "FantasyPros utility",
  html_in_title: "HTML in title",
  category_index: "Category/Hub",
  tool_or_landing: "Tool/Landing",
  non_article_generic: "Generic title",
};

const SKIP_LABEL: Record<IngestLogRow["reason"], string> = {
  blocked_by_filter: "Blocked by filter",
  non_nfl_league: "Non-NFL league",
  invalid_item: "Invalid RSS item",
  fetch_error: "Fetch error",
};

function fmtDate(val: unknown): string {
  if (!val) return "";
  if (val instanceof Date) return val.toLocaleString();
  if (typeof val === "string") {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? val : d.toLocaleString();
  }
  return String(val);
}

function Badge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      {text}
    </span>
  );
}

function ReasonBadge({ code }: { code: string }) {
  return <Badge text={REASON_LABEL[code] ?? code} />;
}

/* ───────────────────────── Admin Nav (same as Sources) ─────────────────── */
function AdminNav({ active }: { active: "sources" | "excluded" }) {
  const base =
    "rounded-md px-3 py-1.5 text-sm font-medium border transition";
  const normal =
    "border-zinc-200 text-zinc-700 hover:bg-zinc-50";
  const current =
    "border-emerald-300 bg-emerald-50 text-emerald-900";

  return (
    <nav className="sticky top-0 z-20 mb-6 -mx-2 flex items-center gap-2 bg-white/70 px-2 py-2 backdrop-blur">
      <Link
        className={`${base} ${active === "sources" ? current : normal}`}
        href="/admin/sources"
      >
        Sources
      </Link>
      <Link
        className={`${base} ${active === "excluded" ? current : normal}`}
        href="/admin/excluded"
      >
        Excluded
      </Link>
      {/* add more admin pages here as needed */}
    </nav>
  );
}

/* ───────────────────────── UI Components ───────────────────────── */
function Group({ title, items }: { title: string; items: ExcludedRow[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">
        {title} ({items.length})
      </h2>
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={r.id} className="rounded-xl border p-3">
            <div className="mb-1 flex flex-wrap gap-2">
              {r.reasons.map((k) => (
                <ReasonBadge key={k} code={k} />
              ))}
            </div>
            <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
              {r.title || "(no title)"}
            </a>
            <div className="text-sm text-gray-500">
              {r.source} • {r.domain}
              {(() => {
                const when = r.discovered_at ?? r.published_at;
                return when ? ` • ${fmtDate(when)}` : "";
              })()}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LogRow({ r }: { r: IngestLogRow }) {
  return (
    <li className="rounded-xl border p-3">
      <div className="mb-1 flex flex-wrap gap-2">
        <Badge text={SKIP_LABEL[r.reason]} />
        {r.detail ? <Badge text={r.detail} /> : null}
      </div>
      <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
        {r.title || "(no title)"}
      </a>
      <div className="text-sm text-gray-500">
        {r.source} • {r.domain} • {fmtDate(r.created_at)}
      </div>
    </li>
  );
}

/* ───────────────────────── Page ────────────────────────────────── */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // Fetch data
  const [rowsRaw, logs] = await Promise.all([
    getExcludedItems({ days: 30, limit: 250 }),
    getIngestLogs(7, 200),
  ]);

  // Ensure we're only showing EXCLUDED rows: require at least one reason tag
  const rows = rowsRaw.filter((r) => (r.reasons?.length ?? 0) > 0);

  // Group excluded items by first reason
  const groups = new Map<string, ExcludedRow[]>();
  for (const r of rows) {
    const k = r.reasons[0] ?? "unknown";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  // Notice banner from ?notice=
  const notice =
    (Array.isArray(sp?.notice) ? sp.notice?.[0] : sp?.notice) ?? null;

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-8">
      {/* Admin nav */}
      <AdminNav active="excluded" />

      {notice ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Excluded Items</h1>
      </div>

      {/* ── Controls Row: Ingest + Backfill ── */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Ingest */}
        <form action={runIngest} className="rounded-xl border p-4">
          <h2 className="mb-3 text-lg font-semibold">Run Ingest</h2>
          <PendingFieldset>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium">Source ID (optional)</label>
                <input
                  name="sourceId"
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 3141"
                  className="h-8 w-28 rounded border px-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium">Limit (optional)</label>
                <input
                  name="limit"
                  type="number"
                  inputMode="numeric"
                  placeholder="50"
                  className="h-8 w-24 rounded border px-2 text-sm"
                />
              </div>
              <RunIngestButton />
            </div>
          </PendingFieldset>
        </form>

        {/* Backfill */}
        <form action={runBackfill} className="rounded-xl border p-4">
          <h2 className="mb-3 text-lg font-semibold">Run Backfill (classify)</h2>
          <PendingFieldset>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium">Batch</label>
                <input
                  name="batch"
                  type="number"
                  inputMode="numeric"
                  defaultValue={500}
                  className="h-8 w-28 rounded border px-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium">From ID</label>
                <input
                  name="fromId"
                  type="number"
                  inputMode="numeric"
                  defaultValue={0}
                  className="h-8 w-28 rounded border px-2 text-sm"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input name="dryRun" type="checkbox" className="h-4 w-4" />
                Dry run
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input name="debug" type="checkbox" className="h-4 w-4" />
                Debug
              </label>
              <button
                type="submit"
                className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-black"
              >
                Run Backfill
              </button>
            </div>
          </PendingFieldset>
        </form>
      </div>

          <div className="space-y-8">
          {/* your existing cards/controls */}
          <JobRunner />
          </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Recent Ingest Skips (7d)</h2>
        <ul className="space-y-2">
          {logs.map((r) => (
            <LogRow key={r.id} r={r} />
          ))}
        </ul>
      </section>

      {[...groups.entries()].map(([k, items]) => (
        <Group key={k} title={REASON_LABEL[k] ?? k} items={items} />
      ))}
    </main>
  );
}
