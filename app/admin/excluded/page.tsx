import {
  getExcludedItems,
  type ExcludedRow,
  getIngestLogs,
  type IngestLogRow,
} from "@/lib/excludedData";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { PendingFieldset, RunIngestButton } from "@/components/admin/RunIngestControls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ───────────────────────── Server Action ─────────────────────────
async function runIngest(formData: FormData) {
  "use server";

  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    console.error("[/admin/excluded] Missing ADMIN_KEY env var");
    revalidatePath("/admin/excluded");
    return;
  }

  // NOTE: headers() is async in your setup — await it
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
    await fetch(`${base}/api/admin/ingest`, {
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

  revalidatePath("/admin/excluded");
}

// ───────────────────────── Labels & Utils ────────────────────────
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

// ───────────────────────── UI Components ─────────────────────────
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
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
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
      <a
        href={r.url}
        target="_blank"
        rel="noreferrer"
        className="font-medium hover:underline"
      >
        {r.title || "(no title)"}
      </a>
      <div className="text-sm text-gray-500">
        {r.source} • {r.domain} • {fmtDate(r.created_at)}
      </div>
    </li>
  );
}

// ───────────────────────── Page ──────────────────────────────────
export default async function Page() {
  const [rows, logs] = await Promise.all([
    getExcludedItems({ days: 30, limit: 250 }),
    getIngestLogs(7, 200),
  ]);

  const groups = new Map<string, ExcludedRow[]>();
  for (const r of rows) {
    const k = r.reasons[0] ?? "unknown";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Excluded Items</h1>

        {/* Run Ingest (server action + client-side pending UI) */}
        <form action={runIngest}>
          <PendingFieldset>
            <div className="flex items-end gap-2">
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
