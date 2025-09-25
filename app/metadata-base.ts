import type { Metadata } from "next";

export const SITE_ORIGIN = "https://thefantasyreport.com";

export const BASE_METADATA: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: "The Fantasy Report — Fantasy Football Headlines, Waivers, Rankings",
    template: "%s · The Fantasy Report",
  },
  description:
    "The Fantasy Report curates the best fantasy football content: headlines, waiver wire targets, rankings, start/sit advice, DFS picks, and injury news.",
  openGraph: {
    type: "website",
    url: SITE_ORIGIN,
    siteName: "The Fantasy Report",
    title: "The Fantasy Report — Fantasy Football Headlines, Waivers, Rankings",
    description:
      "Curated fantasy football headlines, waiver wire targets, rankings, start/sit, DFS, and injury updates.",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "The Fantasy Report" }] ,
  },
  twitter: {
    card: "summary_large_image",
    site: "@tfantasyr",
    title: "The Fantasy Report — Fantasy Football Headlines, Waivers, Rankings",
    description:
      "Curated fantasy football headlines, waiver wire targets, rankings, start/sit, DFS, and injury updates.",
    images: ["/og.jpg"],
  },
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};
