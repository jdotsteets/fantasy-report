// app/metadata-base.ts
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
    images: [
      { url: "/og.jpg", width: 1200, height: 630, alt: "The Fantasy Report" }, // ✅ correct path
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@tfantasyr", // or your preferred handle, but be consistent
    title: "The Fantasy Report — Fantasy Football Headlines, Waivers, Rankings",
    description:
      "Curated fantasy football headlines, waiver wire targets, rankings, start/sit, DFS, and injury updates.",
    images: ["/og.jpg"], // ✅ correct path
  },
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};
