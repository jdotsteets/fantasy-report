// app/api/admin/run-ingest-now/route.ts
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCES_TO_INGEST = [
  3057, 3058, 3121, 3122, 3123, 3124, 6, 7, 14, 15, 2917,
];

export async function POST(request: Request) {
  const startTime = Date.now();
  console.log('[ingest] Manual ingest triggered');
  
  const results = [];
  
  for (const sourceId of SOURCES_TO_INGEST) {
    try {
      const ingestUrl = new URL('/api/admin/ingest', request.url);
      const response = await fetch(ingestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) },
        body: JSON.stringify({
          sourceId,
          limit: 20,
          sport: 'nfl',
        }),
      });
      
      const data = await response.json();
      results.push({
        sourceId,
        ok: response.ok,
        ...data,
      });
      
      console.log(`[ingest] Source ${sourceId}: new=${data.new || 0}, processed=${data.processed || 0}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[ingest] Source ${sourceId} failed: ${errMsg}`);
      results.push({
        sourceId,
        ok: false,
        error: errMsg,
      });
    }
  }
  
  const totalNew = results.reduce((sum, r) => sum + (r.new || 0), 0);
  const totalProcessed = results.reduce((sum, r) => sum + (r.processed || 0), 0);
  const duration = Math.round((Date.now() - startTime) / 1000);
  
  console.log(`[ingest] Complete: new=${totalNew}, processed=${totalProcessed}, duration=${duration}s`);
  
  // Get newest article timestamp
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  const { data: newest } = await supabase
    .from('articles')
    .select('discovered_at')
    .order('discovered_at', { ascending: false })
    .limit(1);
  
  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    sources: SOURCES_TO_INGEST.length,
    totalNew,
    totalProcessed,
    duration: `${duration}s`,
    newestArticle: newest?.[0]?.discovered_at || null,
    results,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
