// app/admin/briefs/[id]/page.tsx
import Link from "next/link";
import { getBriefById } from "@/lib/briefs";
import BriefEditor from "./ui/BriefEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteParams = { id: string };
type PageProps = { params?: Promise<RouteParams> };

export default async function AdminBriefDetail({ params }: PageProps) {
  const { id } = await (params as Promise<RouteParams>);
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) {
    return <main className="p-8">Invalid id.</main>;
  }
  const brief = await getBriefById(idNum);
  if (!brief) {
    return <main className="p-8">Brief not found.</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit Brief #{brief.id}</h1>
        <div className="flex gap-2">
          <Link
            href={`/brief/${brief.slug}`}
            className="rounded-md border px-3 py-2 text-sm hover:bg-zinc-50"
            target="_blank"
          >
            View page ↗
          </Link>
          <Link
            href="/admin/briefs"
            className="rounded-md border px-3 py-2 text-sm hover:bg-zinc-50"
          >
            Back
          </Link>
        </div>
      </div>
      <BriefEditor
        briefId={brief.id}
        initial={{
          summary: brief.summary,
          why_matters: brief.why_matters,
          seo_title: brief.seo_title,
          seo_description: brief.seo_description,
          status: brief.status,
          slug: brief.slug,
        }}
      />
    </main>
  );
}
