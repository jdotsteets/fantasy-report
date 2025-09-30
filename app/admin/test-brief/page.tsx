import { dbQueryRows } from "@/lib/db";
import Link from "next/link";

export const runtime = "nodejs";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  title: string;
  domain: string | null;
  published_at: Date | string | null; // ← allow Date
};

async function getRecent(): Promise<Row[]> {
  return dbQueryRows<Row>(`
    SELECT id, title, domain, published_at
    FROM articles
    ORDER BY id DESC
    LIMIT 25
  `);
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isFinite(dt.getTime()) ? dt.toLocaleString() : String(d);
}

export default async function TestBriefPage() {
  const recent = await getRecent();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
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
                  #{r.id} • {r.domain ?? "source"} • {fmtDate(r.published_at)}
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
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

import Tester from "./tester";
