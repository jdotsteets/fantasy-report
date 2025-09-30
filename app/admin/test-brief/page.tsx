// app/admin/test-brief/page.tsx
import { dbQueryRows } from "@/lib/db";
import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";

export const runtime = "nodejs";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type Row = { id: number; title: string; domain: string | null; published_at: string | null };

async function getRecent(): Promise<Row[]> {
  return dbQueryRows<Row>(
    `SELECT id, title, domain, published_at
       FROM articles
     ORDER BY id DESC
     LIMIT 25`
  );
}

export default async function TestBriefPage() {
  const recent = await getRecent();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
    <AdminNav active="test-brief" />
      <h1 className="text-2xl font-semibold">Brief Test Harness</h1>

      <Tester recent={recent} />

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-semibold">Recent articles</h2>
        <div className="grid gap-2">
          {recent.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded border p-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{r.title}</div>
                <div className="text-xs text-zinc-500">
                  #{r.id} • {r.domain ?? "source"} • {r.published_at ?? "—"}
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  className="rounded border px-3 py-1 text-sm hover:bg-zinc-50"
                  href={`/api/test-brief/${r.id}`}
                  target="_blank"
                >
                  Run API
                </Link>
                <button
                  className="rounded border px-3 py-1 text-sm hover:bg-zinc-50"
                  onClick={() => (document.getElementById("tester-id") as HTMLInputElement).value = String(r.id)}
                >
                  Use ID
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

// --- client side runner ---
"use client";
import { useState } from "react";

function Tester({ recent }: { recent: Row[] }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function run(id: string) {
    const n = Number(id);
    if (!Number.isFinite(n)) return alert("Enter a valid article id");
    setLoading(true);
    try {
      const res = await fetch(`/api/test-brief/${n}`, { cache: "no-store" });
      const json = await res.json();
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
          id="tester-id"
          placeholder="article_id"
          className="w-40 rounded border px-2 py-1"
          defaultValue={recent[0]?.id ?? ""}
        />
        <button
          className="rounded border px-3 py-1 text-sm hover:bg-zinc-50"
          onClick={() => run((document.getElementById("tester-id") as HTMLInputElement).value)}
          disabled={loading}
        >
          {loading ? "Running…" : "Run"}
        </button>
        <a
          className="rounded border px-3 py-1 text-sm hover:bg-zinc-50"
          href={`/api/test-brief/${recent[0]?.id ?? ""}`}
          target="_blank"
        >
          Open raw JSON
        </a>
      </div>

      {result && (
        <pre className="mt-4 max-h-[60vh] overflow-auto rounded bg-zinc-50 p-3 text-xs">
{JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  );
}
