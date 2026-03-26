import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

const TEAM_MAP: Record<string, string> = {
  "Cardinals": "ARI", "Falcons": "ATL", "Ravens": "BAL", "Bills": "BUF",
  "Panthers": "CAR", "Bears": "CHI", "Bengals": "CIN", "Browns": "CLE",
  "Cowboys": "DAL", "Broncos": "DEN", "Lions": "DET", "Packers": "GB",
  "Texans": "HOU", "Colts": "IND", "Jaguars": "JAX", "Chiefs": "KC",
  "Raiders": "LV", "Chargers": "LAC", "Rams": "LAR", "Dolphins": "MIA",
  "Vikings": "MIN", "Patriots": "NE", "Saints": "NO", "Giants": "NYG",
  "Jets": "NYJ", "Eagles": "PHI", "Steelers": "PIT", "49ers": "SF",
  "Seahawks": "SEA", "Buccaneers": "TB", "Titans": "TEN", "Commanders": "WSH"
};

// ALL transaction types from NFL.com (green highlighted)
const TRANSACTION_TYPES = ["trades", "signings", "reserve-list", "waivers", "terminations", "other"];

async function fetchTransactions(type: string, year: number, month: number) {
  try {
    const monthStr = month.toString().padStart(2, '0');
    const url = `https://www.nfl.com/transactions/league/${type}/${year}/${month}`;
    
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return [];
    
    const html = await response.text();
    const transactions: any[] = [];
    
    // Parse table: From, To, Date, Name, Position, Transaction
    const pattern = /<tr>\s*<td>[\s\S]*?class="d3-o-club-(?:full|short)name">\s*([^<\n]+?)[\s\S]*?class="d3-o-club-(?:full|short)name">\s*([^<\n]+?)[\s\S]*?<td>\s*(\d{2}\/\d{2})\s*<\/td>\s*<td[^>]*>\s*(?:<a[^>]*>)?([^<]+?)(?:<\/a>)?\s*<\/td>\s*<td[^>]*>\s*([^<]*?)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/gi;
    
    let match;
    while ((match = pattern.exec(html)) && transactions.length < 100) {
      const [, teamFrom, teamTo, date, player, position, txType] = match;
      
      transactions.push({
        teamFrom: teamFrom.trim(),
        teamFromKey: TEAM_MAP[teamFrom.trim()] || null,
        teamTo: teamTo.trim(),
        teamToKey: TEAM_MAP[teamTo.trim()] || null,
        date: date.trim(),
        player: player.trim(),
        position: position.trim(),
        type: txType.trim(),
        sourceType: type
      });
    }
    
    return transactions;
  } catch (error) {
    console.error(`Error fetching ${type}:`, error);
    return [];
  }
}

function normalizeType(type: string, source: string): string {
  const t = type.toLowerCase();
  if (t.includes("sign") || source === "signings") return "Signed";
  if (t.includes("trad") || source === "trades") return "Traded";
  if (t.includes("waiv") || source === "waivers") return "Waiver";
  if (t.includes("rele") || t.includes("termin") || source === "terminations") return "Released";
  if (t.includes("reserv") || source === "reserve-list") return "Reserve";
  return "Other";
}

export async function POST() {
  try {
    // DYNAMIC YEAR/MONTH - handles rollover automatically (yellow highlighted fix)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    
    const all: any[] = [];
    
    // Fetch ALL types (green highlighted)
    for (const type of TRANSACTION_TYPES) {
      const txs = await fetchTransactions(type, year, month);
      all.push(...txs);
    }
    
    if (all.length === 0) {
      return NextResponse.json({ 
        success: true, 
        total: 0, 
        ingested: 0,
        yearMonth: `${year}/${month}`,
        types: TRANSACTION_TYPES.join(", ")
      });
    }
    
    const sourceResult = await dbQuery(
      "SELECT id FROM sources WHERE url = $1 LIMIT 1",
      ["https://www.nfl.com/transactions/"]
    );
    const sourceId = sourceResult.rows[0]?.id || null;
    
    let ingested = 0;
    
    for (const tx of all) {
      try {
        const [m, d] = tx.date.split("/");
        const date = new Date(year, parseInt(m) - 1, parseInt(d));
        const normalized = normalizeType(tx.type, tx.sourceType);
        
        await dbQuery(
          `INSERT INTO transactions (
            source_id, transaction_date, player_name, position,
            team_key, team_name, team_from, team_to,
            transaction_type, transaction_type_normalized,
            details, source_url
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (player_name, transaction_date, transaction_type, source_url) DO NOTHING`,
          [
            sourceId, date, tx.player, tx.position,
            tx.teamToKey, tx.teamTo, tx.teamFrom, tx.teamTo,
            tx.type, normalized,
            `${tx.teamFrom} → ${tx.teamTo}`,
            `https://www.nfl.com/transactions/league/${tx.sourceType}/${year}/${month}`
          ]
        );
        ingested++;
      } catch (err) {
        // Skip duplicates silently
      }
    }
    
    return NextResponse.json({
      success: true,
      total: all.length,
      ingested,
      yearMonth: `${year}/${month}`,
      types: TRANSACTION_TYPES.join(", ")
    });
  } catch (error) {
    console.error("Route error:", error);
    return NextResponse.json({ 
      success: false, 
      error: String(error) 
    }, { status: 500 });
  }
}
