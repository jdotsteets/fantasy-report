"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type JobStatus = "queued" | "running" | "success" | "error";
type Job = {
  id: string;
  status: JobStatus;
  progress_current: number;
  progress_total: number | null;
  last_message: string | null;
  error_detail: string | null;
};

type EventRow = {
  id: number;
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  meta?: Record<string, unknown> | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isJobStatus(v: unknown): v is JobStatus {
  return v === "queued" || v === "running" || v === "success" || v === "error";
}
function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}
function isNullableNumber(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}
function isJob(v: unknown): v is Job {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    isJobStatus(v.status) &&
    typeof v.progress_current === "number" &&
    isNullableNumber(v.progress_total) &&
    isNullableString(v.last_message) &&
    isNullableString(v.error_detail)
  );
}
function parseJobEnvelope(raw: unknown): Job | null {
  if (!isRecord(raw)) return null;
  const maybeJob = raw.job as unknown;
  return isJob(maybeJob) ? maybeJob : null;
}

function coerceId(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseEventsEnvelope(raw: unknown): EventRow[] {
  if (!isRecord(raw)) return [];
  const ev = raw.events as unknown;
  if (!Array.isArray(ev)) return [];

  const out: EventRow[] = [];
  for (const e of ev) {
    if (!isRecord(e)) continue;

    // Narrow fields safely from unknown
    const id = coerceId((e as { id?: unknown }).id);
    const levelRaw = (e as { level?: unknown }).level;
    const level =
      typeof levelRaw === "string" ? levelRaw : String(levelRaw ?? "");

    const ts = (e as { ts?: unknown }).ts;
    const message = (e as { message?: unknown }).message;
    const metaUnknown = (e as { meta?: unknown }).meta;

    if (
      id !== null &&
      typeof ts === "string" &&
      typeof message === "string" &&
      (level === "info" || level === "warn" || level === "error" || level === "debug")
    ) {
      const meta = isRecord(metaUnknown)
        ? (metaUnknown as Record<string, unknown>)
        : null;

      out.push({
        id,
        ts,
        level: level as EventRow["level"],
        message,
        meta,
      });
    }
  }
  return out;
}

async function safeJson(res: Response): Promise<unknown | null> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function JobRunner() {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busy, setBusy] = useState(false);
  const lastEventIdRef = useRef<number>(0);

  const startIngest = useCallback(
    async (sourceId?: number, limit?: number, debug?: boolean) => {
      setBusy(true);
      setEvents([]);
      lastEventIdRef.current = 0;

      const res = await fetch("/api/admin/jobs/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId, limit, debug }),
      });

      const data = (await safeJson(res)) as
        | { ok?: boolean; job_id?: string; error?: string }
        | null;

      if (!data?.ok || !data.job_id) {
        setBusy(false);
        throw new Error((data && data.error) || "Failed to start ingest");
      }

      setJob({
        id: data.job_id,
        status: "running",
        progress_current: 0,
        progress_total: null,
        last_message: null,
        error_detail: null,
      });
    },
    []
  );

  // poll job status
  useEffect(() => {
    if (!job?.id) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/jobs/${job.id}`);
        if (!res.ok) return;
        const parsed = parseJobEnvelope(await safeJson(res));
        if (!parsed) return;
        setJob(parsed);
        if (parsed.status === "success" || parsed.status === "error") {
          setBusy(false);
        }
      } catch {
        /* ignore transient errors */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id]);

  // poll events incrementally (dedupe on id)
  useEffect(() => {
    if (!job?.id) return;
    const t = setInterval(async () => {
      try {
        const after =
          lastEventIdRef.current > 0 ? `?after=${lastEventIdRef.current}` : "";
        const res = await fetch(`/api/admin/jobs/${job.id}/events${after}`);
        if (!res.ok) return;
        const evs = parseEventsEnvelope(await safeJson(res));
        if (evs.length > 0) {
          lastEventIdRef.current = evs[evs.length - 1].id;
          setEvents((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const merged = [...prev];
            for (const e of evs) if (!seen.has(e.id)) merged.push(e);
            return merged;
          });
        }
      } catch {
        /* ignore */
      }
    }, 800);
    return () => clearInterval(t);
  }, [job?.id]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <label className="flex flex-col">
          <span className="text-sm text-gray-600">Source ID (optional)</span>
          <input id="sourceId" className="border rounded px-2 py-1" placeholder="e.g. 3141" />
        </label>
        <label className="flex flex-col">
          <span className="text-sm text-gray-600">Limit</span>
          <input id="limit" className="border rounded px-2 py-1" defaultValue="50" />
        </label>
        <label className="flex items-center gap-2">
          <input id="debug" type="checkbox" />
          <span>Debug</span>
        </label>
        <button
          className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            const s = (document.getElementById("sourceId") as HTMLInputElement | null)?.value.trim();
            const l = (document.getElementById("limit") as HTMLInputElement | null)?.value.trim();
            const d = (document.getElementById("debug") as HTMLInputElement | null)?.checked ?? false;
            const sourceId = s ? Number(s) : undefined;
            const limit = l ? Number(l) : undefined;
            startIngest(sourceId, limit, d).catch((err: unknown) =>
              alert(err instanceof Error ? err.message : String(err))
            );
          }}
        >
          {busy ? "Running…" : "Run Ingest"}
        </button>
      </div>

      {job && (
        <div className="rounded border p-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">
              Job {job.id.slice(0, 8)} • {job.status}
            </div>
            <div className="text-sm text-gray-600">
              {job.progress_total
                ? `${job.progress_current}/${job.progress_total}`
                : `${job.progress_current}`}
            </div>
          </div>

          <div className="mt-3 h-56 overflow-auto rounded bg-gray-50 p-2 text-sm font-mono">
            {events.length === 0 ? (
              <div className="text-gray-500">No events yet…</div>
            ) : (
              events.map((e) => (
                <div key={e.id} className="mb-1">
                  <span className="text-gray-500 mr-2">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                  <span
                    className={
                      e.level === "error"
                        ? "text-red-600"
                        : e.level === "warn"
                        ? "text-yellow-700"
                        : e.level === "debug"
                        ? "text-purple-700"
                        : "text-gray-900"
                    }
                  >
                    {e.level.toUpperCase()}
                  </span>
                  <span className="ml-2">{e.message}</span>
                  {e.meta && Object.keys(e.meta).length > 0 && (
                    <pre className="ml-2 mt-1 inline-block align-top rounded bg-white/70 px-2 py-1 text-xs text-gray-600">
                      {JSON.stringify(e.meta, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>

          {job.status === "error" && job.error_detail && (
            <div className="mt-2 text-red-700 text-sm">{job.error_detail}</div>
          )}
        </div>
      )}
    </div>
  );
}
