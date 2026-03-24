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

export function filterArticlesByTeam<T extends { title: string; url?: string; canonical_url?: string; summary?: string | null }>(
  articles: T[],
  teamId: string
): T[] {
  const team = getTeamById(teamId);
  if (!team) return [];
  
  return articles.filter(article => {
    const searchText = `${article.title} ${article.url ?? ""} ${article.canonical_url ?? ""} ${article.summary ?? ""}`.toLowerCase();
    return team.aliases.some(alias => searchText.includes(alias.toLowerCase())) ||
           searchText.includes(team.name.toLowerCase()) ||
           searchText.includes(team.shortName.toLowerCase());
  });
}
