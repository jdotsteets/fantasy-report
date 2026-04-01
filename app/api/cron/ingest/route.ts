// app/api/cron/ingest/route.ts
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

// List of source IDs to ingest (top priority sources)
const SOURCES_TO_INGEST = [
  // Active high-yield sources (based on Apr 2026 audit)
  3136, // Yahoo Fantasy NFL (52 articles/week)
  3137, // NBC ProFootballTalk (35 articles/week)
  3057, // PFF - NFL (20 articles/week)
  6,    // Yahoo Sports NFL (33 articles/week)
  7,    // Rotoballer NFL (18 articles/week)
  2918, // ESPN Fantasy (7 articles/week)
  3133, // CBS Sports - NFL (11 articles/week)
  15,   // FOOTBALL GUYS news (12 articles/week)
  3121, // FantasyPros Main (12 articles/week)
  9,    // Pro Football Rumors (16 articles/week)
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
  
  // Fetch transactions from NFL.com
  try {
    const transactionUrl = new URL('/api/admin/ingest/transactions', request.url);
    const txResponse = await fetch(transactionUrl, { method: 'POST' });
    const txData = await txResponse.json();
    console.log('[cron/ingest] Transactions:', txData.inserted || 0, 'new,', txData.total || 0, 'total');
  } catch (error) {
    console.error('[cron/ingest] Transaction fetch failed:', error);
  }
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
