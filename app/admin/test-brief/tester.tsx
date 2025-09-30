"use client";

import { useState } from "react";

type Row = { id: number; title: string; domain: string | null; published_at: Date | string | null };

export default function Tester({ recent }: { recent: Row[] }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown | null>(null); // <- allow null
  const [id, setId] = useState<string>(recent[0]?.id ? String(recent[0].id) : "");

  async function run() {
    const n = Number(id);
    if (!Number.isFinite(n)) {
      alert("Enter a valid article id");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/test-brief/${n}`, { cache: "no-store" });
      const json: unknown = await res.json();
      setResult(json);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 text-lg font-semibold">Run a dry-run</h2>
      <div className="flex gap-2">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="article_id"
          className="w-40 rounded border px-2 py-1"
        />
        <button className="rounded border px-3 py-1 text-sm hover:bg-zinc-50" onClick={run} disabled={loading}>
          {loading ? "Running…" : "Run"}
        </button>
        {id && (
          <a
            className="rounded border px-3 py-1 text-sm hover:bg-zinc-50"
            href={`/api/test-brief/${id}`}
            target="_blank"
            rel="noreferrer"
          >
            Open raw JSON
          </a>
        )}
      </div>

      {result !== null && ( // <- boolean, not unknown
        <pre className="mt-4 max-h-[60vh] overflow-auto rounded bg-zinc-50 p-3 text-xs">
          {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  );
}
