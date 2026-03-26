// Server-side only utilities for team filtering
// DO NOT import this in client components

import { dbQuery } from "@/lib/db";
import { getTeamById } from "@/lib/teams";

/**
 * Fetch team roster from database (server-side only)
 */
export async function getTeamRoster(teamId: string): Promise<string[]> {
  try {
    const result = await dbQuery(
      `SELECT full_name, search_names 
       FROM players 
       WHERE team = $1 AND active = true`,
      [teamId.toUpperCase()]
    );
    
    // Flatten all player names and search variations
    const names = new Set<string>();
    result.rows.forEach((row: any) => {
      if (row.full_name) names.add(row.full_name.toLowerCase());
      if (row.search_names && Array.isArray(row.search_names)) {
        row.search_names.forEach((n: string) => names.add(n.toLowerCase()));
      }
    });
    
    return Array.from(names);
  } catch (error) {
    console.error("Failed to fetch team roster:", error);
    return [];
  }
}

/**
 * Enhanced team filtering with roster player matching (server-side only)
 */
export function filterArticlesByTeamWithRoster<T extends { 
  title: string; 
  url?: string; 
  canonical_url?: string | null; 
  summary?: string | null;
}>(
  articles: T[],
  teamId: string,
  roster: string[]
): T[] {
  const team = getTeamById(teamId);
  if (!team) return [];
  
  return articles.filter(article => {
    let score = 0;
    
    const title = article.title.toLowerCase();
    const url = (article.url || article.canonical_url || "").toLowerCase();
    const summary = (article.summary || "").toLowerCase();
    const fullText = `${title} ${url} ${summary}`;
    
    // Team name matching (higher weight)
    for (const alias of team.aliases) {
      const pattern = new RegExp(`\\b${alias.toLowerCase()}\\b`, "i");
      if (pattern.test(title)) score += 3;
      if (pattern.test(url)) score += 2;
      if (pattern.test(summary)) score += 1;
    }
    
    // Player name matching (medium weight)
    for (const playerName of roster) {
      if (fullText.includes(playerName)) {
        score += 2; // Player mention worth 2 points
        break; // Only count once per article
      }
    }
    
    return score >= 2;
  });
}