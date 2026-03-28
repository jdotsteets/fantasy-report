import { NextResponse } from "next/server";
import { getHomeData } from "@/lib/HomeData";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const data = await getHomeData({});
  
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    latestNewsCount: data.latestNews.length,
    latestNews: data.latestNews.slice(0, 10).map(a => ({
      id: a.id,
      title: a.title,
      published_at: a.published_at,
      primary_topic: a.primary_topic
    })),
    heroId: data.hero?.id,
    heroTitle: data.hero?.title
  });
}
