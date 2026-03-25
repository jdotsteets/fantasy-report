import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

// Normalized transaction types
const TRANSACTION_TYPES: Record<string, string> = {
  signed: "Signed",
  released: "Released",
  waived: "Waived",
  traded: "Traded",
  claimed: "Claimed",
  activated: "Activated",
  "placed on ir": "Placed on IR",
  "placed on reserve": "Placed on Reserve",
  elevated: "Elevated",
  "practice squad": "Practice Squad",
};

function normalizeTransactionType(raw: string): string {
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(TRANSACTION_TYPES)) {
    if (lower.includes(key)) return value;
  }
  return "Other";
}

// Parse NFL.com transactions HTML
async function fetchNFLTransactions() {
  try {
    const response = await fetch("https://www.nfl.com/transactions/", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    
    if (!response.ok) {
      throw new Error(`NFL.com returned ${response.status}`);
    }

    const html = await response.text();
    
    // Pattern matches rows with 6 TDs: teamFrom, teamTo, date, player, position, transaction
    const rowPattern = /<tr>\s*<td>[\s\S]*?href="\/teams\/([^"]+)"[\s\S]*?<div class="d3-o-club-(?:full|short)name">\s*([^<\n]+)[\s\S]*?<\/td>\s*<td>[\s\S]*?href="\/teams\/([^"]+)"[\s\S]*?<div class="d3-o-club-(?:full|short)name">\s*([^<\n]+)[\s\S]*?<\/td>\s*<td>\s*(\d{2}\/\d{2})\s*<\/td>\s*<td>\s*(?:<a[^>]*>)?([^<]+?)(?:<\/a>)?\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>\s*<\/tr>/gi;
    
    const transactions: any[] = [];
    let match;
    let count = 0;
    
    while ((match = rowPattern.exec(html)) && count < 100) {
      try {
        const [, teamFromSlug, teamFromName, teamToSlug, teamToName, date, player, position, transactionType] = match;
        
        transactions.push({
          date: date.trim(),
          teamFrom: teamFromName.trim(),
          teamTo: teamToName.trim(),
          teamFromSlug: teamFromSlug.trim(),
          teamToSlug: teamToSlug.trim(),
          player: player.trim(),
          position: position.trim() || null,
          transaction: transactionType.trim(),
        });
        count++;
      } catch (e) {
        // Skip bad row
        continue;
      }
    }

    return transactions;
  } catch (error) {
    console.error("Failed to fetch NFL transactions:", error);
    return [];
  }
}

// Map team names to abbreviations
const TEAM_ABBR: Record<string, string> = {
  "Cardinals": "ARI", "Falcons": "ATL", "Ravens": "BAL", "Bills": "BUF",
  "Panthers": "CAR", "Bears": "CHI", "Bengals": "CIN", "Browns": "CLE",
  "Cowboys": "DAL", "Broncos": "DEN", "Lions": "DET", "Packers": "GB",
  "Texans": "HOU", "Colts": "IND", "Jaguars": "JAX", "Chiefs": "KC",
  "Raiders": "LV", "Chargers": "LAC", "Rams": "LAR", "Dolphins": "MIA",
  "Vikings": "MIN", "Patriots": "NE", "Saints": "NO", "Giants": "NYG",
  "Jets": "NYJ", "Eagles": "PHI", "Steelers": "PIT", "49ers": "SF",
  "Seahawks": "SEA", "Buccaneers": "TB", "Titans": "TEN", "Commanders": "WSH",
};

export async function POST(request: Request) {
  try {
    const transactions = await fetchNFLTransactions();
    
    if (transactions.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: "No transactions found",
        ingested: 0 
      });
    }

    let ingested = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const t of transactions) {
      try {
        // Parse date (MM/DD format, use current year)
        const [month, day] = t.date.split('/');
        const currentYear = new Date().getFullYear();
        const transDate = new Date(currentYear, parseInt(month) - 1, parseInt(day));
        
        if (isNaN(transDate.getTime())) {
          throw new Error(`Invalid date: ${t.date}`);
        }

        // Get team abbreviation (prefer teamTo for Traded, teamFrom for Released/Waived/Signed)
        const primaryTeam = t.transaction.toLowerCase().includes('traded') ? t.teamTo : t.teamFrom;
        const teamKey = TEAM_ABBR[primaryTeam] || primaryTeam.substring(0, 3).toUpperCase();
        
        const normalized = normalizeTransactionType(t.transaction);
        
        // Create a unique source_id
        const sourceId = `${teamKey}-${t.player}-${t.date}-${t.transaction}`.replace(/\s+/g, '-');
        
        // Insert with conflict handling
        await dbQuery(
          `INSERT INTO transactions (
            source, source_url, source_id, transaction_date,
            team_key, team_name, player_name, position,
            transaction_type_raw, transaction_type_normalized, details
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (source, source_id, transaction_date, player_name) 
          DO NOTHING`,
          [
            "nfl.com",
            "https://www.nfl.com/transactions/",
            sourceId,
            transDate,
            teamKey,
            primaryTeam,
            t.player,
            t.position,
            t.transaction,
            normalized,
            `${t.teamFrom} → ${t.teamTo}`,
          ]
        );

        ingested++;
      } catch (error) {
        failed++;
        errors.push(`Failed to ingest ${t.player}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    return NextResponse.json({
      success: true,
      total: transactions.length,
      ingested,
      failed,
      errors: errors.slice(0, 10), // Return first 10 errors
    });
  } catch (error) {
    console.error("Transaction ingestion failed:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}