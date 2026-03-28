// app/api/cron/ingest/route.ts
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

// List of source IDs to ingest (top priority sources)
const SOURCES_TO_INGEST = [
  3057, // PFF - NFL
  3058, // PFF - Fantasy
  3121, // FantasyPros Main
  3122, // FantasyPros Rankings
  3123, // FantasyPros Start/Sit
  3124, // FantasyPros Waiver Wire
  6,    // Yahoo Sports NFL
  7,    // Rotoballer NFL
  14,   // PFF NFL News
  15,   // Fantasy Guys
  2917, // Fantasy Footballers
];

export async function GET(request: Request) {
  // Verify this is called by Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = [];
  
  for (const sourceId of SOURCES_TO_INGEST) {
    try {
      const ingestUrl = new URL('/api/admin/ingest', request.url);
      const response = await fetch(ingestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId,
          limit: 20, // Fetch 20 articles per source
          sport: 'nfl',
        }),
      });
      
      const data = await response.json();
      results.push({
        sourceId,
        ok: response.ok,
        ...data,
      });
    } catch (error) {
      results.push({
        sourceId,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  
  const totalNew = results.reduce((sum, r) => sum + (r.new || 0), 0);
  const totalProcessed = results.reduce((sum, r) => sum + (r.processed || 0), 0);
  
  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    sources: SOURCES_TO_INGEST.length,
    totalNew,
    totalProcessed,
    results,
  });
}
