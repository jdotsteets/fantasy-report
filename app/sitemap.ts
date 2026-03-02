// app/sitemap.ts
import type { MetadataRoute } from "next";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const ORIGIN = "https://www.thefantasyreport.com";

const SECTION_PATHS: string[] = [
  "/?section=news",
  "/?section=waivers",
  "/?section=rankings",
  "/?section=start-sit",
  "/?section=injury",
  "/?section=dfs",
  "/?section=advice",
];

type Row = {
  id: number;
  canonical_url: string | null;
  url: string;
  published_at: string | null;
  discovered_at: string | null;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 1) Static/home & sections
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${ORIGIN}/`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 1,
    },
    ...SECTION_PATHS.map<MetadataRoute.Sitemap[number]>((p) => ({
      url: `${ORIGIN}${p}`,
      lastModified: now,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
  ];

  // 2) Article URLs (recent slice)
  const { rows } = await dbQuery<Row>(`
    SELECT id, canonical_url, url, published_at, discovered_at
    FROM articles
    WHERE (published_at IS NOT NULL AND published_at >= NOW() - INTERVAL '400 days')
       OR (published_at IS NULL AND discovered_at >= NOW() - INTERVAL '400 days')
    ORDER BY COALESCE(published_at, discovered_at) DESC
    LIMIT 5000
  `);

  const articleEntries: MetadataRoute.Sitemap = rows.map<MetadataRoute.Sitemap[number]>((r) => {
    const target = r.canonical_url ?? r.url ?? `/go/${r.id}`;
    const lastMod = r.published_at ?? r.discovered_at ?? now.toISOString();
    return {
      url: target.startsWith("http") ? target : `${ORIGIN}${target}`,
      lastModified: new Date(lastMod),
      changeFrequency: "daily" as const,
      priority: 0.6,
    };
  });

  return [...staticEntries, ...articleEntries];
}
