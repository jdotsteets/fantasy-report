import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { calculateArticleScore } from "@/lib/scoring";

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Get unscored or low-scored articles from last 7 days
    const articles = await dbQuery<{
      id: number;
      title: string;
      canonical_url: string;
      domain: string | null;
      source_id: number | null;
      primary_topic: string | null;
      secondary_topic: string | null;
      players: string[] | null;
      published_at: string | null;
      discovered_at: string | null;
      current_score: number | null;
    }>(`
      SELECT 
        id, title, canonical_url, domain, source_id,
        primary_topic, secondary_topic, players,
        published_at, discovered_at,
        score as current_score
      FROM articles
      WHERE sport = 'nfl'
        AND discovered_at >= NOW() - INTERVAL '7 days'
        AND (score IS NULL OR score = 0)
      ORDER BY discovered_at DESC
      LIMIT 1000
    `);

    let updated = 0;
    const scores: Array<{ id: number; score: number }> = [];

    // Calculate scores
    for (const article of articles.rows) {
      const score = calculateArticleScore({
        title: article.title,
        url: article.canonical_url,
        domain: article.domain || new URL(article.canonical_url).hostname,
        sourceId: article.source_id ?? undefined,
        primary_topic: article.primary_topic,
        secondary_topic: article.secondary_topic,
        players: article.players,
        published_at: article.published_at,
        discovered_at: article.discovered_at,
      });

      scores.push({ id: article.id, score });
    }

    // Batch update in chunks of 100
    for (let i = 0; i < scores.length; i += 100) {
      const chunk = scores.slice(i, i + 100);
      
      await dbQuery(
        `UPDATE articles
         SET score = data.score
         FROM (VALUES ${chunk.map((_, idx) => `($${idx * 2 + 1}::bigint, $${idx * 2 + 2}::numeric)`).join(', ')})
         AS data(id, score)
         WHERE articles.id = data.id`,
        chunk.flatMap(s => [s.id, s.score])
      );

      updated += chunk.length;
    }

    return NextResponse.json({
      success: true,
      articlesScored: updated,
      sampleScores: scores.slice(0, 10),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
