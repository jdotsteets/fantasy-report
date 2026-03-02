// app/admin/briefs/page.tsx
import Link from "next/link";
import { listBriefs } from "@/lib/briefs";
import CreateBriefButton from "./ui/CreateBriefButton";
import { AdminNav } from "@/components/admin/AdminNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminBriefsPage() {
  const briefs = await listBriefs(100);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
            {/* Admin toolbar */}
      <AdminNav active="briefs" />
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Briefs</h1>
          <p className="mt-1 text-sm text-zinc-600">Create and edit summary briefs linked to articles.</p>
        </div>
        <div className="flex items-center gap-2">
          <CreateBriefButton />
          <Link href="/" className="rounded-md border px-3 py-2 text-sm hover:bg-zinc-50">
            ← Back to site
          </Link>
        </div>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-zinc-50 text-left">
            <th className="p-2">ID</th>
            <th className="p-2">Title</th>
            <th className="p-2">Status</th>
            <th className="p-2">Slug</th>
            <th className="p-2">Source</th>
            <th className="p-2 w-24">Edit</th>
          </tr>
        </thead>
        <tbody>
          {briefs.map((b) => (
            <tr key={b.id} className="border-b">
              <td className="p-2">{b.id}</td>
              <td className="p-2">
                <div className="max-w-[36ch] truncate" title={b.article_title}>
                  {b.seo_title ?? b.article_title}
                </div>
              </td>
              <td className="p-2">
                <span
                  className={[
                    "rounded-full border px-2 py-0.5 text-xs",
                    b.status === "published"
                      ? "border-green-500 text-green-700"
                      : b.status === "draft"
                      ? "border-amber-500 text-amber-700"
                      : "border-zinc-400 text-zinc-600",
                  ].join(" ")}
                >
                  {b.status}
                </span>
              </td>
              <td className="p-2">
                <div className="max-w-[32ch] truncate">{b.slug}</div>
              </td>
              <td className="p-2">{b.source_name ?? b.article_domain ?? "—"}</td>
              <td className="p-2">
                <Link href={`/admin/briefs/${b.id}`} className="rounded-md border px-2 py-1 hover:bg-zinc-50">
                  Edit
                </Link>
              </td>
            </tr>
          ))}
          {briefs.length === 0 && (
            <tr>
              <td className="p-4 text-zinc-500" colSpan={6}>
                No briefs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
