// Local script to populate transactions (bypasses Vercel cache issue)
// Run: node populate-transactions.mjs

import pg from 'pg';
const { Pool } = pg;

const TEAM_MAP = {
  "Cardinals": "ARI", "Falcons": "ATL", "Ravens": "BAL", "Bills": "BUF",
  "Panthers": "CAR", "Bears": "CHI", "Bengals": "CIN", "Browns": "CLE",
  "Cowboys": "DAL", "Broncos": "DEN", "Lions": "DET", "Packers": "GB",
  "Texans": "HOU", "Colts": "IND", "Jaguars": "JAX", "Chiefs": "KC",
  "Raiders": "LV", "Chargers": "LAC", "Rams": "LAR", "Dolphins": "MIA",
  "Vikings": "MIN", "Patriots": "NE", "Saints": "NO", "Giants": "NYG",
  "Jets": "NYJ", "Eagles": "PHI", "Steelers": "PIT", "49ers": "SF",
  "Seahawks": "SEA", "Buccaneers": "TB", "Titans": "TEN", "Commanders": "WSH"
};

const TYPES = ["trades", "signings", "reserve-list", "waivers", "terminations"];

async function fetchTransactions(type, year, month) {
  const url = `https://www.nfl.com/transactions/league/${type}/${year}/${month}`;
  console.log(`Fetching ${type}...`);
  
  const response = await fetch(url);
  if (!response.ok) return [];
  
  const html = await response.text();
  const transactions = [];
  
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
  
  console.log(`  Found ${transactions.length}`);
  return transactions;
}

function normalizeType(type, source) {
  const t = type.toLowerCase();
  if (t.includes("sign") || source === "signings") return "Signed";
  if (t.includes("trad") || source === "trades") return "Traded";
  if (t.includes("waiv") || source === "waivers") return "Waiver";
  if (t.includes("rele") || t.includes("termin") || source === "terminations") return "Released";
  if (t.includes("reserv") || source === "reserve-list") return "Reserve";
  return "Other";
}

const pool = new Pool({
  connectionString: "postgresql://postgres:JimboRocks23!@db.jziinxyvfngxvkjtltqp.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false }
});

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

console.log(`\n=== FETCHING TRANSACTIONS FOR ${year}/${month} ===\n`);

const all = [];
for (const type of TYPES) {
  const txs = await fetchTransactions(type, year, month);
  all.push(...txs);
}

console.log(`\nTotal fetched: ${all.length}`);

// Clear old
await pool.query("DELETE FROM transactions WHERE source_url LIKE '%nfl.com%'");
console.log('Cleared old transactions');

// Source ID lookup skipped - use null
const sourceId = null;

let ingested = 0;
for (const tx of all) {
  try {
    const [m, d] = tx.date.split("/");
    const date = new Date(year, parseInt(m) - 1, parseInt(d));
    const normalized = normalizeType(tx.type, tx.sourceType);
    
    await pool.query(
      `INSERT INTO transactions (
        source_id, transaction_date, player_name, position,
        team_key, team_name,
        transaction_type_raw, transaction_type_normalized,
        details, source_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        sourceId, date, tx.player, tx.position,
        tx.teamToKey, tx.teamTo,
        tx.type, normalized,
        `${tx.teamFrom} → ${tx.teamTo}`,
        `https://www.nfl.com/transactions/league/${tx.sourceType}/${year}/${month}`
      ]
    );
    ingested++;
  } catch (err) {
    console.error(`Insert error for ${tx.player}:`, err.message);
  }
}

console.log(`\n✅ Ingested ${ingested} transactions`);

// Show summary
const types = await pool.query(`
  SELECT transaction_type_normalized, COUNT(*) as count
  FROM transactions
  GROUP BY transaction_type_normalized
  ORDER BY count DESC
`);

console.log('\n=== BY TYPE ===');
types.rows.forEach(r => {
  console.log(`${r.transaction_type_normalized}: ${r.count}`);
});

await pool.end();
console.log('\n✅ Done! Transactions should now appear on the homepage.');
