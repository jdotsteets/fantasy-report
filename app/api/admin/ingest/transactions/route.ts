import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

const TEAM_ABBR: Record<string, string> = {
  Cardinals: "ARI", Falcons: "ATL", Ravens: "BAL", Bills: "BUF",
  Panthers: "CAR", Bears: "CHI", Bengals: "CIN", Browns: "CLE",
  Cowboys: "DAL", Broncos: "DEN", Lions: "DET", Packers: "GB",
  Texans: "HOU", Colts: "IND", Jaguars: "JAX", Chiefs: "KC",
  Raiders: "LV", Chargers: "LAC", Rams: "LAR", Dolphins: "MIA",
  Vikings: "MIN", Patriots: "NE", Saints: "NO", Giants: "NYG",
  Jets: "NYJ", Eagles: "PHI", Steelers: "PIT", "49ers": "SF",
  Seahawks: "SEA", Buccaneers: "TB", Titans: "TEN", Commanders: "WSH"
};

// Get current year and month
function getCurrentYearMonth() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1, // 1-12
  };
}

// Parse NFL.com transactions HTML for a specific type
async function fetchNFLTransactions(type: string, year: number, month: number) {
  try {
    const url = `https://www.nfl.com/transactions/league/${type}/${year}/${month}`;
    console.log(`Fetching ${type} from ${url}`);
    
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    
    if (!response.ok) {
      console.warn(`NFL.com ${type} returned ${response.status}`);
      return [];
    }
    
    const html = await response.text();
    const transactions: any[] = [];
    
    // Match 6-column table: teamFrom, teamTo, date, player, position, transactionType
    const rowPattern = /<tr>\s*<td>[\s\S]*?href="\/teams\/([^"]+)"[\s\S]*?<div class="d3-o-club-(?:full|short)name">\s*([^\n<]+)[\s\S]*?<\/td>\s*<td>[\s\S]*?href="\/teams\/([^"]+)"[\s\S]*?<div class="d3-o-club-(?:full|short)name">\s*([^\n<]+)[\s\S]*?<\/td>\s*<td>\s*(\d{2}\/\d{2})\s*<\/td>\s*<td>\s*(?:<a[^>]*>)?([^<]+?)(?:<\/a>)?\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>\s*<\/tr>/gi;
    
    let match;
    let count = 0;
    
    while ((match = rowPattern.exec(html)) && count < 100) {
      const [, teamFromSlug, teamFromName, teamToSlug, teamToName, date, player, position, transactionType] = match;
      
      transactions.push({
        teamFrom: teamFromName.trim(),
        teamFromKey: TEAM_ABBR[teamFromName.trim()] || null,
        teamTo: teamToName.trim(),
        teamToKey: TEAM_ABBR[teamToName.trim()] || null,
        date: date.trim(),
        player: player.trim(),
        position: position.trim(),
        type: transactionType.trim(),
        sourceType: type, // 'signings', 'trades', 'waivers', 'releases'
      });
      
      count++;
    }
    
    console.log(`Parsed ${transactions.length} ${type} transactions`);
    return transactions;
  } catch (error) {
    console.error(`Failed to fetch ${type} transactions:`, error);
    return [];
  }
}

// Normalize transaction types
function normalizeType(type: string, sourceType: string): string {
  const t = type.toLowerCase();
  
  if (t.includes("sign") || sourceType === "signings") return "Signed";
  if (t.includes("trad") || sourceType === "trades") return "Traded";
  if (t.includes("waiv") || sourceType === "waivers") return "Waiver";
  if (t.includes("rele") || sourceType === "releases") return "Released";
  if (t.includes("term")) return "Terminated";
  if (t.includes("retir")) return "Retired";
  if (t.includes("claim")) return "Claimed";
  
  return "Other";
}

export async function POST(request: Request) {
  try {
    const { year, month } = getCurrentYearMonth();
    
    // Fetch all transaction types for current month
    const types = ["trades", "signings", "waivers", "releases"];
    const allTransactions: any[] = [];
    
    for (const type of types) {
      const txs = await fetchNFLTransactions(type, year, month);
      allTransactions.push(...txs);
    }
    
    console.log(`Total transactions fetched: ${allTransactions.length}`);
    
    if (allTransactions.length === 0) {
      return NextResponse.json({
        success: true,
        total: 0,
        ingested: 0,
        message: "No transactions found for current month",
      });
    }
    
    let ingested = 0;
    let failed = 0;
    const errors: string[] = [];
    
    // Get source ID
    const sourceResult = await dbQuery(
      `SELECT id FROM sources WHERE url = $1 LIMIT 1`,
      ["https://www.nfl.com/transactions/"]
    );
    const sourceId = sourceResult.rows[0]?.id || null;
    
    for (const tx of allTransactions) {
      try {
        // Parse date (MM/DD format - add current year)
        const [m, d] = tx.date.split("/");
        const transDate = new Date(year, parseInt(m) - 1, parseInt(d));
        
        const normalized = normalizeType(tx.type, tx.sourceType);
        
        await dbQuery(
          `INSERT INTO transactions (
            source_id, transaction_date, player_name, position,
            team_key, team_name, team_from, team_to,
            transaction_type, transaction_type_normalized,
            details, source_url
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (player_name, transaction_date, transaction_type, source_url)
          DO NOTHING`,
          [
            sourceId,
            transDate,
            tx.player,
            tx.position,
            tx.teamToKey,
            tx.teamTo,
            tx.teamFrom,
            tx.teamTo,
            tx.type,
            normalized,
            `${tx.teamFrom} → ${tx.teamTo}`,
            `https://www.nfl.com/transactions/league/${tx.sourceType}/${year}/${month}`,
          ]
        );
        
        ingested++;
      } catch (error) {
        failed++;
        errors.push(`${tx.player}: ${error instanceof Error ? error.message : "Unknown"}`);
      }
    }
    
    return NextResponse.json({
      success: true,
      total: allTransactions.length,
      ingested,
      failed,
      yearMonth: `${year}/${month}`,
      types: types.join(", "),
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error("Transaction sync failed:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}