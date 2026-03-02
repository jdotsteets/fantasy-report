"use client";

import { useEffect, useMemo, useState } from "react";

type Row = { id: number; title: string; domain: string | null; published_at: Date | string | null };

type PromptsPayload = {
  system_writer: string;
  system_critic: string;
};

type Result = unknown;

/* ───────────────── helpers ───────────────── */

function safeParseJson<T>(s: string): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) as T };
  } catch {
    return { ok: false };
  }
}

function isLikelyJson(contentType: string | null): boolean {
  return !!contentType && contentType.toLowerCase().includes("application/json");
}

/* ───────────────── component ───────────────── */

export default function Tester({ recent }: { recent: Row[] }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [id, setId] = useState<string>(recent[0]?.id ? String(recent[0].id) : "");
  const [systemWriter, setSystemWriter] = useState<string>("");
  const [systemCritic, setSystemCritic] = useState<string>("");

  // for quick debugging context in the UI
  const [lastStatus, setLastStatus] = useState<number | null>(null);
  const [lastContentType, setLastContentType] = useState<string | null>(null);

  const canRun = useMemo(() => {
    const n = Number(id);
    return Number.isFinite(n) && n > 0 && systemWriter.trim().length > 0;
  }, [id, systemWriter]);

  async function loadDefaults() {
    setLoading(true);
    try {
      const res = await fetch("/api/test-brief/prompts", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load prompts (${res.status})`);
      const json = (await res.json()) as PromptsPayload;
      setSystemWriter(json.system_writer);
      setSystemCritic(json.system_critic);
    } finally {
      setLoading(false);
    }
  }

  async function runWithOverrides() {
    const n = Number(id);
    if (!Number.isFinite(n)) {
      alert("Enter a valid article id");
      return;
    }
    setLoading(true);
    setResult(null);
    setLastStatus(null);
    setLastContentType(null);
    try {
      const res = await fetch(`/api/test-brief/${n}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          system_writer: systemWriter,
          system_critic: systemCritic,
        } satisfies PromptsPayload),
      });

      const ct = res.headers.get("content-type");
      const text = await res.text();
      setLastStatus(res.status);
      setLastContentType(ct);

      if (!res.ok) {
        const parsed = isLikelyJson(ct) ? safeParseJson<Result>(text) : ({ ok: false } as const);
        setResult(parsed.ok ? parsed.value : { ok: false, status: res.status, body: text });
        return;
        }

      const parsed = isLikelyJson(ct) ? safeParseJson<Result>(text) : safeParseJson<Result>(text);
      setResult(parsed.ok ? parsed.value : text);
    } finally {
      setLoading(false);
    }
  }

  async function runDry() {
    const n = Number(id);
    if (!Number.isFinite(n)) {
      alert("Enter a valid article id");
      return;
    }
    setLoading(true);
    setResult(null);
    setLastStatus(null);
    setLastContentType(null);
    try {
      const res = await fetch(`/api/test-brief/${n}`, { cache: "no-store" });

      const ct = res.headers.get("content-type");
      const text = await res.text();
      setLastStatus(res.status);
      setLastContentType(ct);

      if (!res.ok) {
        const parsed = isLikelyJson(ct) ? safeParseJson<Result>(text) : ({ ok: false } as const);
        setResult(parsed.ok ? parsed.value : { ok: false, status: res.status, body: text });
        return;
      }

      const parsed = isLikelyJson(ct) ? safeParseJson<Result>(text) : safeParseJson<Result>(text);
      setResult(parsed.ok ? parsed.value : text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 text-lg font-semibold">Prompt Workbench</h2>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="article_id"
          className="w-40 rounded border px-2 py-1"
        />
        <button
          className="rounded border px-3 py-1 text-sm hover:bg-zinc-50"
          onClick={runDry}
          disabled={loading}
          title="Run with server defaults (no overrides)"
        >
          {loading ? "Running…" : "Run (defaults)"}
        </button>
        <button
          className="rounded border px-3 py-1 text-sm hover:bg-zinc-50"
          onClick={loadDefaults}
          disabled={loading}
          title="Reload SYSTEM_WRITER and SYSTEM_CRITIC from file"
        >
          {loading ? "Loading…" : "Load defaults"}
        </button>
        <button
          className="rounded border px-3 py-1 text-sm hover:bg-zinc-50"
          onClick={runWithOverrides}
          disabled={loading || !canRun}
          title="POST with your edited prompts"
        >
          {loading ? "Running…" : "Run with overrides"}
        </button>
      </div>

      {/* WRITER PROMPT */}
      <label className="mb-1 block text-sm font-medium">SYSTEM_WRITER override</label>
      <textarea
        value={systemWriter}
        onChange={(e) => setSystemWriter(e.target.value)}
        placeholder="Paste or edit SYSTEM_WRITER here…"
        className="mb-4 h-56 w-full resize-y whitespace-pre-wrap rounded border p-2 font-mono text-xs"
      />

      {/* CRITIC PROMPT (optional) */}
      <label className="mb-1 block text-sm font-medium">SYSTEM_CRITIC override (optional)</label>
      <textarea
        value={systemCritic}
        onChange={(e) => setSystemCritic(e.target.value)}
        placeholder="Paste or edit SYSTEM_CRITIC here…"
        className="mb-4 h-40 w-full resize-y whitespace-pre-wrap rounded border p-2 font-mono text-xs"
      />

      {result !== null && (
        <div className="mt-4">
          <div className="mb-1 text-sm font-medium">
            Result {lastStatus !== null && <>· <span className="text-zinc-500">HTTP {lastStatus}</span></>}
            {lastContentType && <> · <span className="text-zinc-500">{lastContentType}</span></>}
          </div>
          <pre className="max-h-[60vh] overflow-auto rounded bg-zinc-50 p-3 text-xs">
            {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
