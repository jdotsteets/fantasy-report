// app/brief/[slug]/head.tsx or generateMetadata in page.tsx (Next 14)
import { getBriefBySlug } from "@/lib/briefs";


export async function generateMetadata({ params }: { params: { slug: string } }) {
  const brief = await getBriefBySlug(params.slug);
  if (!brief) return {};
  return {
    title: brief.seo_title ?? brief.article_title,
    description: brief.seo_description ?? brief.summary,
    alternates: { canonical: `https://www.thefantasyreport.com/brief/${brief.slug}` },
    openGraph: {
      type: "article",
      title: brief.seo_title ?? brief.article_title,
      description: brief.seo_description ?? brief.summary,
      url: `https://www.thefantasyreport.com/brief/${brief.slug}`,
      siteName: "The Fantasy Report",
      images: brief.article_image_url ? [{ url: brief.article_image_url }] : undefined,
    },
  };
}
