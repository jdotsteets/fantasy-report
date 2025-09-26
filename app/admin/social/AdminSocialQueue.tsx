"use client";

import { useMemo, useState } from "react";
import type { SocialQueueRow } from "./page";

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

type UpdatePayload = {
  status?: "draft" | "approved" | "scheduled" | "published" | "failed";
  scheduled_for?: string | null; // ISO string or null to clear
};

async function updateDraft(id: number, payload: UpdatePayload): Promise<void> {
  const res = await fetch(`/api/social/drafts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const j: { error?: string } = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(j.error ?? "Update failed");
  }
}

async function seedSection(type: "waivers" | "rankings" | "news" | "injuries" | "start-sit"): Promise<void> {
  const url = `/api/social/sections/seed?type=${encodeURIComponent(type)}`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const j: { error?: string } = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(j.error ?? "Seed failed");
  }
}

async function runWorker(): Promise<void> {
  const res = await fetch("/api/social/worker", { method: "POST" });
  if (!res.ok) {
    const j: { error?: string } = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(j.error ?? "Worker failed");
  }
}

async function publishNow(id: number): Promise<void> {
  const res = await fetch(`/api/social/publish-now/${id}`, { method: "POST" });
  const j: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) {
    throw new Error(j.error ?? "Publish failed");
  }
}

export default function AdminSocialQueue({ rows }: { rows: SocialQueueRow[] }) {
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [busyGlobal, setBusyGlobal] = useState<boolean>(false);

  const grouped = useMemo(() => {
    const map: Record<string, SocialQueueRow[]> = {};
    for (const r of rows) {
      const key = r.status;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return map;
  }, [rows]);

  async function handleApprove(id: number) {
    setWorkingId(id);
    try {
      await updateDraft(id, { status: "approved" });
      window.location.reload();
    } finally {
      setWorkingId(null);
    }
  }

  async function handleSchedule(id: number, minutesFromNow: number) {
    setWorkingId(id);
    try {
      const when = new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
      await updateDraft(id, { status: "scheduled", scheduled_for: when });
      window.location.reload();
    } finally {
      setWorkingId(null);
    }
  }

  async function handlePublishNow(id: number) {
    setWorkingId(id);
    try {
      await publishNow(id);
      window.location.reload();
    } finally {
      setWorkingId(null);
    }
  }

  async function handleSeed(type: "waivers" | "rankings" | "news" | "injuries" | "start-sit") {
    setBusyGlobal(true);
    try {
      await seedSection(type);
      // Optional: immediately run worker so it posts soon
      // await runWorker();
      window.location.reload();
    } finally {
      setBusyGlobal(false);
    }
  }

  async function handleRunWorker() {
    setBusyGlobal(true);
    try {
      await runWorker();
      window.location.reload();
    } finally {
      setBusyGlobal(false);
    }
  }

  return (
    <main className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Social Queue</h1>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-1 rounded-xl border disabled:opacity-50"
            onClick={() => handleSeed("waivers")}
            disabled={busyGlobal}
            title="Seed a Waiver Wire promo"
          >
            Waivers
          </button>
          <button
            className="px-3 py-1 rounded-xl border disabled:opacity-50"
            onClick={() => handleSeed("rankings")}
            disabled={busyGlobal}
            title="Seed a Rankings promo"
          >
            Rankings
          </button>
          <button
            className="px-3 py-1 rounded-xl border disabled:opacity-50"
            onClick={() => handleSeed("news")}
            disabled={busyGlobal}
            title="Seed a News promo"
          >
            News
          </button>
          <button
            className="px-3 py-1 rounded-xl border disabled:opacity-50"
            onClick={() => handleSeed("injuries")}
            disabled={busyGlobal}
            title="Seed an Injuries promo"
          >
            Injuries
          </button>
          <button
            className="px-3 py-1 rounded-xl border disabled:opacity-50"
            onClick={() => handleSeed("start-sit")}
            disabled={busyGlobal}
            title="Seed a Start/Sit promo"
          >
            Start/Sit
          </button>
          <button
            className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50"
            onClick={handleRunWorker}
            disabled={busyGlobal}
            title="Post all due now"
          >
            Post All Due
          </button>
        </div>
      </div>

      {(["draft", "approved", "scheduled"] as const).map((bucket) => (
        <section key={bucket} className="space-y-3">
          <h2 className="text-xl font-medium capitalize">{bucket}</h2>
          <div className="grid grid-cols-1 gap-4">
            {grouped[bucket]?.map((r) => (
              <article key={r.id} className="border rounded-2xl p-4 shadow-sm bg-white">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-500">
                      {r.platform.toUpperCase()} • {r.source_name ?? r.domain ?? "unknown"}
                    </div>
                    <h3 className="font-semibold truncate">{r.article_title ?? "(no title)"}</h3>
                    <p className="text-sm text-gray-600 line-clamp-2">{r.hook}</p>
                    <p className="text-sm text-gray-700 mt-1 whitespace-pre-line">{r.body}</p>
                    {r.cta ? <p className="text-sm text-gray-700 mt-1">{r.cta}</p> : null}
                    <div className="text-xs text-gray-500 mt-2">
                      Publ: {fmt(r.published_at)} • Disc: {fmt(r.discovered_at)} • Schd: {fmt(r.scheduled_for)}
                    </div>
                    {r.article_url ? (
                      <a className="text-blue-600 text-sm underline" href={r.article_url} target="_blank" rel="noreferrer">
                        Open article
                      </a>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {bucket === "draft" && (
                      <>
                        <button
                          className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50"
                          onClick={() => handleApprove(r.id)}
                          disabled={workingId === r.id}
                        >
                          Approve
                        </button>
                        <button
                          className="px-3 py-1 rounded-xl border disabled:opacity-50"
                          onClick={() => handleSchedule(r.id, 60)}
                          disabled={workingId === r.id}
                        >
                          Schedule +60m
                        </button>
                        <button
                          className="px-3 py-1 rounded-xl border disabled:opacity-50"
                          onClick={() => handlePublishNow(r.id)}
                          disabled={workingId === r.id}
                        >
                          Post Now
                        </button>
                      </>
                    )}
                    {bucket === "approved" && (
                      <>
                        <button
                          className="px-3 py-1 rounded-xl border disabled:opacity-50"
                          onClick={() => handleSchedule(r.id, 30)}
                          disabled={workingId === r.id}
                        >
                          Schedule +30m
                        </button>
                        <button
                          className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50"
                          onClick={() => handlePublishNow(r.id)}
                          disabled={workingId === r.id}
                        >
                          Post Now
                        </button>
                      </>
                    )}
                    {bucket === "scheduled" && (
                      <button
                        className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50"
                        onClick={() => handlePublishNow(r.id)}
                        disabled={workingId === r.id}
                      >
                        Post Now
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}

            {!grouped[bucket]?.length && (
              <div className="text-sm text-gray-500">No items.</div>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
