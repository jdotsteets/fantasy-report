// Team filtering utilities for Fantasy Report
export interface Team {
  id: string;
  name: string;
  shortName: string;
  aliases: string[];
  division: string;
}

export const NFL_TEAMS: Team[] = [
  { id: "buf", name: "Buffalo Bills", shortName: "Bills", aliases: ["Buffalo", "BUF"], division: "AFC East" },
  { id: "mia", name: "Miami Dolphins", shortName: "Dolphins", aliases: ["Miami", "MIA"], division: "AFC East" },
  { id: "ne", name: "New England Patriots", shortName: "Patriots", aliases: ["New England", "NE"], division: "AFC East" },
  { id: "nyj", name: "New York Jets", shortName: "Jets", aliases: ["NY Jets", "NYJ"], division: "AFC East" },
  { id: "bal", name: "Baltimore Ravens", shortName: "Ravens", aliases: ["Baltimore", "BAL"], division: "AFC North" },
  { id: "cin", name: "Cincinnati Bengals", shortName: "Bengals", aliases: ["Cincinnati", "CIN"], division: "AFC North" },
  { id: "cle", name: "Cleveland Browns", shortName: "Browns", aliases: ["Cleveland", "CLE"], division: "AFC North" },
  { id: "pit", name: "Pittsburgh Steelers", shortName: "Steelers", aliases: ["Pittsburgh", "PIT"], division: "AFC North" },
  { id: "hou", name: "Houston Texans", shortName: "Texans", aliases: ["Houston", "HOU"], division: "AFC South" },
  { id: "ind", name: "Indianapolis Colts", shortName: "Colts", aliases: ["Indianapolis", "IND"], division: "AFC South" },
  { id: "jax", name: "Jacksonville Jaguars", shortName: "Jaguars", aliases: ["Jacksonville", "JAX"], division: "AFC South" },
  { id: "ten", name: "Tennessee Titans", shortName: "Titans", aliases: ["Tennessee", "TEN"], division: "AFC South" },
  { id: "den", name: "Denver Broncos", shortName: "Broncos", aliases: ["Denver", "DEN"], division: "AFC West" },
  { id: "kc", name: "Kansas City Chiefs", shortName: "Chiefs", aliases: ["Kansas City", "KC"], division: "AFC West" },
  { id: "lv", name: "Las Vegas Raiders", shortName: "Raiders", aliases: ["Las Vegas", "LV"], division: "AFC West" },
  { id: "lac", name: "Los Angeles Chargers", shortName: "Chargers", aliases: ["LA Chargers", "LAC"], division: "AFC West" },
  { id: "dal", name: "Dallas Cowboys", shortName: "Cowboys", aliases: ["Dallas", "DAL"], division: "NFC East" },
  { id: "nyg", name: "New York Giants", shortName: "Giants", aliases: ["NY Giants", "NYG"], division: "NFC East" },
  { id: "phi", name: "Philadelphia Eagles", shortName: "Eagles", aliases: ["Philadelphia", "PHI"], division: "NFC East" },
  { id: "wsh", name: "Washington Commanders", shortName: "Commanders", aliases: ["Washington", "WSH"], division: "NFC East" },
  { id: "chi", name: "Chicago Bears", shortName: "Bears", aliases: ["Chicago", "CHI"], division: "NFC North" },
  { id: "det", name: "Detroit Lions", shortName: "Lions", aliases: ["Detroit", "DET"], division: "NFC North" },
  { id: "gb", name: "Green Bay Packers", shortName: "Packers", aliases: ["Green Bay", "GB"], division: "NFC North" },
  { id: "min", name: "Minnesota Vikings", shortName: "Vikings", aliases: ["Minnesota", "MIN"], division: "NFC North" },
  { id: "atl", name: "Atlanta Falcons", shortName: "Falcons", aliases: ["Atlanta", "ATL"], division: "NFC South" },
  { id: "car", name: "Carolina Panthers", shortName: "Panthers", aliases: ["Carolina", "CAR"], division: "NFC South" },
  { id: "no", name: "New Orleans Saints", shortName: "Saints", aliases: ["New Orleans", "NO"], division: "NFC South" },
  { id: "tb", name: "Tampa Bay Buccaneers", shortName: "Buccaneers", aliases: ["Tampa Bay", "TB", "Bucs"], division: "NFC South" },
  { id: "ari", name: "Arizona Cardinals", shortName: "Cardinals", aliases: ["Arizona", "ARI"], division: "NFC West" },
  { id: "lar", name: "Los Angeles Rams", shortName: "Rams", aliases: ["LA Rams", "LAR"], division: "NFC West" },
  { id: "sf", name: "San Francisco 49ers", shortName: "49ers", aliases: ["San Francisco", "SF"], division: "NFC West" },
  { id: "sea", name: "Seattle Seahawks", shortName: "Seahawks", aliases: ["Seattle", "SEA"], division: "NFC West" },
];

export function getTeamById(id: string): Team | null {
  return NFL_TEAMS.find(t => t.id === id) ?? null;
}

export function filterArticlesByTeam<T extends { title: string; url?: string; canonical_url?: string | null; summary?: string | null }>(
  articles: T[],
  teamId: string
): T[] {
  const team = getTeamById(teamId);
  if (!team) return [];
  
  return articles.filter(article => {
    let score = 0;
    
    const title = article.title.toLowerCase();
    const url = (article.url || article.canonical_url || "").toLowerCase();
    const summary = (article.summary || "").toLowerCase();
    
    // Check each team identifier
    for (const id of [team.name.toLowerCase(), team.shortName.toLowerCase(), ...team.aliases.map(a => a.toLowerCase())]) {
      if (title.includes(id)) score += 3;
      if (url.includes(id)) score += 2;
      if (summary.includes(id)) score += 1;
    }
    
    // Minimum score of 2 required (e.g., title match OR url match OR 2 summary mentions)
    return score >= 2;
  });
}


/**
 * Fetch team roster from API (client-side)
 */
export async function getTeamRosterFromAPI(teamId: string): Promise<string[]> {
  try {
    const response = await fetch(`/api/roster?team=${teamId.toUpperCase()}`);
    if (!response.ok) return [];
    
    const data = await response.json();
    return data.players || [];
  } catch (error) {
    console.error("Failed to fetch roster:", error);
    return [];
  }
}

/**
 * Enhanced filtering with player name matching
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

/**
 * Fetch team roster server-side (for server components)
 */
export async function getTeamRoster(teamId: string): Promise<string[]> {
  try {
    const { dbQuery } = await import("@/lib/db");
    
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