// components/admin/JobRunner.tsx
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
type EventRow = { id: number; ts: string; level: "info" | "warn" | "error" | "debug"; message: string };

export default function JobRunner() {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busy, setBusy] = useState(false);
  const lastEventIdRef = useRef<number>(0);

  const startIngest = useCallback(async (sourceId?: number, limit?: number, debug?: boolean) => {
    setBusy(true);
    setEvents([]);
    lastEventIdRef.current = 0;

    const res = await fetch("/api/admin/jobs/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId, limit, debug }),
    });
    const data = (await res.json()) as { ok: boolean; job_id?: string; error?: string };
    if (!data.ok || !data.job_id) {
      setBusy(false);
      throw new Error(data.error ?? "Failed to start ingest");
    }
    setJob({ id: data.job_id, status: "running", progress_current: 0, progress_total: null, last_message: null, error_detail: null });
  }, []);

  // poll job status
  useEffect(() => {
    if (!job?.id) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/admin/jobs/${job.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { job: Job };
      setJob(data.job);
      if (["success", "error"].includes(data.job.status)) {
        setBusy(false);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id]);

  // poll events incrementally
  useEffect(() => {
    if (!job?.id) return;
    const t = setInterval(async () => {
      const after = lastEventIdRef.current > 0 ? `?after=${lastEventIdRef.current}` : "";
      const res = await fetch(`/api/admin/jobs/${job.id}/events${after}`);
      if (!res.ok) return;
      const data = (await res.json()) as { events: EventRow[] };
      if (data.events.length > 0) {
        lastEventIdRef.current = data.events[data.events.length - 1].id;
        setEvents((prev) => [...prev, ...data.events]);
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
            startIngest(sourceId, limit, d).catch((e) => alert(e.message));
          }}
        >
          {busy ? "Running…" : "Run Ingest"}
        </button>
      </div>

      {job && (
        <div className="rounded border p-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">Job {job.id.slice(0, 8)} • {job.status}</div>
            <div className="text-sm text-gray-600">
              {job.progress_total
                ? `${job.progress_current}/${job.progress_total}`
                : `${job.progress_current}`}
            </div>
          </div>

          <div className="mt-3 h-48 overflow-auto rounded bg-gray-50 p-2 text-sm font-mono">
            {events.map((e) => (
              <div key={e.id}>
                <span className="text-gray-500 mr-2">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className={
                  e.level === "error" ? "text-red-600" :
                  e.level === "warn" ? "text-yellow-700" :
                  e.level === "debug" ? "text-purple-700" : "text-gray-900"
                }>
                  {e.level.toUpperCase()}
                </span>
                <span className="ml-2">{e.message}</span>
              </div>
            ))}
          </div>

          {job.status === "error" && job.error_detail && (
            <div className="mt-2 text-red-700 text-sm">{job.error_detail}</div>
          )}
        </div>
      )}
    </div>
  );
}
