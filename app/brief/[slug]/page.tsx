// app/brief/[slug]/page.tsx
import { getBriefBySlug } from "@/lib/briefs";
import Link from "next/link";
import type { Metadata } from "next";

export const runtime = "nodejs";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type RouteParams = { slug: string };
type PageProps = { params: Promise<RouteParams> }; // 👈 matches Next 15’s generated type

export async function generateMetadata(
  props: PageProps
): Promise<Metadata> {
  const { slug } = await props.params;
  const brief = await getBriefBySlug(slug);

  const title = brief?.seo_title ?? brief?.article_title ?? "The Fantasy Report";
  const description = brief?.seo_description ?? brief?.summary ?? undefined;

  // Build absolute URL to the OG route
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.thefantasyreport.com";
  const ogUrl = `${base.replace(/\/+$/, "")}/brief/${slug}/og`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${base.replace(/\/+$/, "")}/brief/${slug}`,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
      siteName: "The Fantasy Report",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function BriefPage({ params }: PageProps) {
  // Next 15 provides params as a Promise; await it
  const { slug } = await (params as Promise<RouteParams>);

  const brief = await getBriefBySlug(slug);
  if (!brief) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-2xl font-semibold">Brief not found</h1>
        <p className="mt-2 text-zinc-600">The brief you requested does not exist.</p>
      </main>
    );
  }

  const outbound = brief.article_url;
  const provider = brief.source_name ?? brief.article_domain ?? "Source";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-zinc-500">
        <Link href="/" className="hover:underline">The Fantasy Report</Link>
        <span className="mx-2">/</span>
        <span>Brief</span>
      </nav>

      {/* Headline */}
      <header className="mb-3">
        <h1 className="text-2xl sm:text-3xl font-serif tracking-tight">
          {brief.seo_title ?? brief.article_title}
        </h1>
        <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
          <span>Source: {provider}</span>
          {brief.article_published_at ? (
            <>
              <span>•</span>
              <time dateTime={brief.article_published_at}>
                {new Date(brief.article_published_at).toLocaleString()}
              </time>
            </>
          ) : null}
        </div>
      </header>

      {/* Summary card */}
      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4">
        <p className="text-zinc-800">{brief.summary}</p>
        {brief.why_matters.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm text-zinc-700">
            {brief.why_matters.map((li, i) => (
              <li key={i}><strong>Why it matters:</strong> {li}</li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <a
            href={outbound}
            className="inline-flex items-center justify-center rounded-md border border-black px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
            target="_blank" rel="noopener noreferrer"
          >
            Read the full article at {provider} →
          </a>
        </div>

        <p className="mt-2 text-[11px] text-zinc-500">
          We share a short brief in our own words and link to the source. Please support original reporting.
        </p>
      </section>

      {/* Optional hero image */}
      {brief.article_image_url ? (
        <div className="mb-8 overflow-hidden rounded-lg border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brief.article_image_url} alt="" className="w-full object-cover" />
        </div>
      ) : null}

      <footer className="border-t pt-4 text-xs text-zinc-500">
        <p>Brief ID: {brief.id} • Canonical: https://www.thefantasyreport.com/brief/{brief.slug}</p>
      </footer>
    </main>
  );
}
