// app/admin/social/AdminSocialQueue.tsx
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

function baseUrl(): string {
  const b = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.thefantasyreport.com";
  return b.replace(/\/+$/, "");
}

function shortlinkFor(row: Pick<SocialQueueRow, "brief_id" | "brief_slug">): string | null {
  if (row.brief_id && row.brief_id > 0) {
    return `${baseUrl()}/b/${row.brief_id}`;
  }
  return null; // will be created on post
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

  async function deleteDraft(id: number): Promise<void> {
    const res = await fetch(`/api/social/drafts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j: { error?: string } = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(j.error ?? "Delete failed");
    }
  }

  async function generateOne(type: "waivers" | "rankings" | "news" | "injuries" | "start-sit" | "mix"): Promise<void> {
    const url = `/api/social/generate-one?type=${encodeURIComponent(type)}`;
    const res = await fetch(url, { method: "POST" });
    const j: { ok?: boolean; id?: number; error?: string } = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error ?? "Generate failed");
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

async function publishNow(id: number): Promise<{ ok: boolean; tweetId?: string; shortlink?: string; error?: string; detail?: string }> {
  const res = await fetch(`/api/social/publish-now/${id}`, { method: "POST" });
  let j: { ok?: boolean; tweetId?: string; shortlink?: string; error?: string; detail?: string } = {};
  try {
    j = await res.json();
  } catch {
    // ignore parse errors; we'll fall back to status text
  }
  if (!res.ok || !j.ok) {
    return {
      ok: false,
      error: j.error ?? res.statusText ?? "Publish failed",
      detail: j.detail,
    };
  }
  return { ok: true, tweetId: j.tweetId, shortlink: j.shortlink };
}


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

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    setWorkingId(id);
    try {
      await deleteDraft(id);
      window.location.reload();
    } finally {
      setWorkingId(null);
    }
  }

  async function handlePublishNow(id: number) {
  setWorkingId(id);
  try {
    const result = await publishNow(id);
    if (!result.ok) {
      const msg = [result.error, result.detail].filter(Boolean).join("\n");
      alert(`❌ Post failed:\n${msg}`);
      return;
    }
    alert(`✅ Posted!\nTweet ID: ${result.tweetId}\nLink: ${result.shortlink}`);
    window.location.reload();
  } finally {
    setWorkingId(null);
  }
}


  async function handleSeed(type: "waivers" | "rankings" | "news" | "injuries" | "start-sit") {
    setBusyGlobal(true);
    try {
      await seedSection(type);
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
          <button className="px-3 py-1 rounded-xl border disabled:opacity-50" onClick={() => handleSeed("waivers")} disabled={busyGlobal}>Waivers</button>
          <button className="px-3 py-1 rounded-xl border disabled:opacity-50" onClick={() => handleSeed("rankings")} disabled={busyGlobal}>Rankings</button>
          <button className="px-3 py-1 rounded-xl border disabled:opacity-50" onClick={() => handleSeed("news")} disabled={busyGlobal}>News</button>
          <button className="px-3 py-1 rounded-xl border disabled:opacity-50" onClick={() => handleSeed("injuries")} disabled={busyGlobal}>Injuries</button>
          <button className="px-3 py-1 rounded-xl border disabled:opacity-50" onClick={() => handleSeed("start-sit")} disabled={busyGlobal}>Start/Sit</button>
          <button className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50" onClick={handleRunWorker} disabled={busyGlobal}>Post All Due</button>
        </div>
      </div>

      {/* Generate 1 draft on-demand */}
      <div className="flex items-center gap-2">
        <select id="genType" className="px-2 py-1 rounded-xl border" disabled={busyGlobal} defaultValue="mix" onChange={() => { /* no-op */ }}>
          <option value="mix">Mix</option>
          <option value="waivers">Waivers</option>
          <option value="rankings">Rankings</option>
          <option value="news">News</option>
          <option value="injuries">Injuries</option>
          <option value="start-sit">Start/Sit</option>
        </select>
        <button
          className="px-3 py-1 rounded-xl border disabled:opacity-50"
          disabled={busyGlobal}
          title="Generate a single new draft"
          onClick={async () => {
            setBusyGlobal(true);
            try {
              const select = document.getElementById("genType") as HTMLSelectElement | null;
              const t = (select?.value ?? "mix") as "waivers" | "rankings" | "news" | "injuries" | "start-sit" | "mix";
              await generateOne(t);
              window.location.reload();
            } finally {
              setBusyGlobal(false);
            }
          }}
        >
          Generate 1
        </button>
      </div>

      {(["draft", "approved", "scheduled"] as const).map((bucket) => (
        <section key={bucket} className="space-y-3">
          <h2 className="text-xl font-medium capitalize">{bucket}</h2>
          <div className="grid grid-cols-1 gap-4">
            {grouped[bucket]?.map((r) => {
              const short = shortlinkFor(r);
              return (
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

                      {/* ID / debug mini-row */}
                      <div className="mt-1 text-xs text-gray-500 flex items-center gap-2">
                        <span>Draft ID: <code className="text-gray-700">{r.id}</code></span>
                        <button
                          type="button"
                          className="rounded border px-1.5 py-[1px] leading-none hover:bg-zinc-50"
                          onClick={async () => {
                            await navigator.clipboard.writeText(String(r.id));
                            alert("Draft ID copied: " + r.id);
                          }}
                          title="Copy Draft ID"
                        >
                          Copy
                        </button>
                      </div>

                      {/* Links preview area */}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                        {short ? (
                          <>
                            <a className="text-emerald-700 underline" href={`/brief/${r.brief_slug ?? ""}`} target="_blank" rel="noreferrer">
                              Open brief
                            </a>
                            <button
                              className="rounded border px-2 py-[2px]"
                              onClick={async () => {
                                await navigator.clipboard.writeText(short);
                                alert("Shortlink copied: " + short);
                              }}
                              title="Copy shortlink used in the tweet"
                            >
                              Copy shortlink
                            </button>
                          </>
                        ) : (
                          <>
                            {r.article_url ? (
                              <a className="text-blue-600 underline" href={r.article_url} target="_blank" rel="noreferrer">
                                Open article
                              </a>
                            ) : null}
                            <span className="text-gray-500">(brief link will be created on post)</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {bucket === "draft" && (
                        <>
                          <button className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50" onClick={() => handleApprove(r.id)} disabled={workingId === r.id}>
                            Approve
                          </button>
                          <button className="px-3 py-1 rounded-xl border disabled:opacity-50" onClick={() => handleSchedule(r.id, 60)} disabled={workingId === r.id}>
                            Schedule +60m
                          </button>
                          <button className="px-3 py-1 rounded-xl border disabled:opacity-50" onClick={() => handlePublishNow(r.id)} disabled={workingId === r.id}>
                            Post Now
                          </button>
                          <button
                            className="px-3 py-1 rounded-xl border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                            onClick={() => handleDelete(r.id)}
                            disabled={workingId === r.id}
                            title="Remove this draft"
                          >
                            Delete
                          </button>
                        </>
                      )}
                      {bucket === "approved" && (
                        <>
                          <button className="px-3 py-1 rounded-xl border disabled:opacity-50" onClick={() => handleSchedule(r.id, 30)} disabled={workingId === r.id}>
                            Schedule +30m
                          </button>
                          <button className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50" onClick={() => handlePublishNow(r.id)} disabled={workingId === r.id}>
                            Post Now
                          </button>
                          <button
                            className="px-3 py-1 rounded-xl border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                            onClick={() => handleDelete(r.id)}
                            disabled={workingId === r.id}
                            title="Remove this draft"
                          >
                            Delete
                          </button>
                        </>
                      )}
                      {bucket === "scheduled" && (
                        <>
                          <button className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50" onClick={() => handlePublishNow(r.id)} disabled={workingId === r.id}>
                            Post Now
                          </button>
                          <button
                            className="px-3 py-1 rounded-xl border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                            onClick={() => handleDelete(r.id)}
                            disabled={workingId === r.id}
                            title="Remove this draft"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            {!grouped[bucket]?.length && <div className="text-sm text-gray-500">No items.</div>}
          </div>
        </section>
      ))}
    </main>
  );
}
