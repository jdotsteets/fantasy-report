/* Reusable JSON-LD builders (no any types) */

export type ImageLike = { url: string; width?: number; height?: number; alt?: string };

export function websiteJsonLd(siteName: string, siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: siteUrl,
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/?q={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  } as const;
}

export function itemListJsonLd(args: {
  name: string;
  items: Array<{ url: string; name: string; image?: string | null }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: args.name,
    itemListElement: args.items.slice(0, 10).map((it, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      url: it.url,
      name: it.name,
      ...(it.image ? { image: it.image } : {})
    }))
  } as const;
}

export function breadcrumbJsonLd(crumbs: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url
    }))
  } as const;
}

export function articleJsonLd(args: {
  headline: string;
  pageUrl: string;
  siteName: string;
  publishedAt: string; // ISO
  updatedAt?: string | null;
  images?: ImageLike[];
  authorOrgName?: string; // default: siteName
  publisherLogoUrl?: string; // absolute URL
}) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: args.headline,
    mainEntityOfPage: args.pageUrl,
    datePublished: args.publishedAt,
    dateModified: args.updatedAt ?? args.publishedAt,
    author: [{ "@type": "Organization", name: args.authorOrgName ?? args.siteName }],
    publisher: {
      "@type": "Organization",
      name: args.siteName,
      ...(args.publisherLogoUrl
        ? { logo: { "@type": "ImageObject", url: args.publisherLogoUrl } }
        : {})
    },
    ...(args.images && args.images.length
      ? {
          image: args.images.map((im) =>
            im.width && im.height
              ? {
                  "@type": "ImageObject",
                  url: im.url,
                  width: im.width,
                  height: im.height
                }
              : im.url
          )
        }
      : {})
  } as const;
}
