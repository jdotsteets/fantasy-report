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
    
    // Simple regex-based parsing (fragile but workable)
    // NFL.com structure: date, team, player, position, transaction
    const transactions: any[] = [];
    
    // Pattern: look for transaction rows
    // This is a simplified parser - adjust based on actual HTML structure
    const rowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>[\s\S]*?<\/tr>/gi;
    
    let match;
    let count = 0;
    while ((match = rowPattern.exec(html)) && count < 100) {
      try {
        const [, date, team, player, position, transaction] = match;
        
        transactions.push({
          date: date?.trim(),
          team: team?.trim(),
          player: player?.trim(),
          position: position?.trim(),
          transaction: transaction?.trim(),
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
        // Parse date
        const transDate = new Date(t.date);
        if (isNaN(transDate.getTime())) {
          throw new Error(`Invalid date: ${t.date}`);
        }

        // Normalize team key (simple mapping)
        const teamKey = t.team?.substring(0, 3).toUpperCase() || null;
        
        const normalized = normalizeTransactionType(t.transaction);
        
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
            `${t.team}-${t.player}-${t.date}`,
            transDate,
            teamKey,
            t.team,
            t.player,
            t.position,
            t.transaction,
            normalized,
            null,
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
