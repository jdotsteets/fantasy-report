// app>api>admin>ingest>transactions>route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

const TEAM_MAP: Record<string, string> = {
  Cardinals: "ARI",
  Falcons: "ATL",
  Ravens: "BAL",
  Bills: "BUF",
  Panthers: "CAR",
  Bears: "CHI",
  Bengals: "CIN",
  Browns: "CLE",
  Cowboys: "DAL",
  Broncos: "DEN",
  Lions: "DET",
  Packers: "GB",
  Texans: "HOU",
  Colts: "IND",
  Jaguars: "JAX",
  Chiefs: "KC",
  Raiders: "LV",
  Chargers: "LAC",
  Rams: "LAR",
  Dolphins: "MIA",
  Vikings: "MIN",
  Patriots: "NE",
  Saints: "NO",
  Giants: "NYG",
  Jets: "NYJ",
  Eagles: "PHI",
  Steelers: "PIT",
  "49ers": "SF",
  Seahawks: "SEA",
  Buccaneers: "TB",
  Titans: "TEN",
  Commanders: "WSH",
};

const TRANSACTION_TYPES = [
  "trades",
  "signings",
  "reserve-list",
  "waivers",
  "terminations",
  "other",
] as const;

type TransactionFeedType = (typeof TRANSACTION_TYPES)[number];

type ParsedTransaction = {
  teamFrom: string;
  teamFromKey: string | null;
  teamTo: string;
  teamToKey: string | null;
  date: string;
  player: string;
  position: string;
  type: string;
  sourceType: TransactionFeedType;
};

type SourceRow = {
  id: string | number;
};

type InsertRow = {
  id: number;
};

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !authHeader) {
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

async function fetchTransactions(
  type: TransactionFeedType,
  year: number,
  month: number
): Promise<ParsedTransaction[]> {
  try {
    const url = `https://www.nfl.com/transactions/league/${type}/${year}/${month}`;

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const transactions: ParsedTransaction[] = [];

    const pattern =
      /<tr>\s*<td>[\s\S]*?class="d3-o-club-(?:full|short)name">\s*([^<\n]+?)[\s\S]*?class="d3-o-club-(?:full|short)name">\s*([^<\n]+?)[\s\S]*?<td>\s*(\d{2}\/\d{2})\s*<\/td>\s*<td[^>]*>\s*(?:<a[^>]*>)?([^<]+?)(?:<\/a>)?\s*<\/td>\s*<td[^>]*>\s*([^<]*?)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/gi;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null && transactions.length < 100) {
      const [, teamFrom, teamTo, date, player, position, txType] = match;

      const cleanTeamFrom = teamFrom.trim();
      const cleanTeamTo = teamTo.trim();

      transactions.push({
        teamFrom: cleanTeamFrom,
        teamFromKey: TEAM_MAP[cleanTeamFrom] ?? null,
        teamTo: cleanTeamTo,
        teamToKey: TEAM_MAP[cleanTeamTo] ?? null,
        date: date.trim(),
        player: player.trim(),
        position: position.trim(),
        type: txType.trim(),
        sourceType: type,
      });
    }

    return transactions;
  } catch (error) {
    console.error(`Error fetching ${type}:`, error);
    return [];
  }
}

function normalizeType(type: string, source: TransactionFeedType): string {
  const lower = type.toLowerCase();

  if (lower.includes("sign") || source === "signings") return "Signed";
  if (lower.includes("trad") || source === "trades") return "Traded";
  if (lower.includes("waiv") || source === "waivers") return "Waiver";

  if (
    lower.includes("rele") ||
    lower.includes("termin") ||
    source === "terminations"
  ) {
    return "Released";
  }

  if (lower.includes("reserv") || source === "reserve-list") return "Reserve";

  return "Other";
}

function parseTransactionDate(
  mmdd: string,
  fallbackYear: number
): Date | null {
  const [monthStr, dayStr] = mmdd.split("/");

  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);

  if (
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return new Date(fallbackYear, month - 1, day);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const allTransactions: ParsedTransaction[] = [];

    for (const type of TRANSACTION_TYPES) {
      const transactions = await fetchTransactions(type, year, month);
      allTransactions.push(...transactions);
    }

    if (allTransactions.length === 0) {
      return NextResponse.json({
        success: true,
        total: 0,
        ingested: 0,
        yearMonth: `${year}/${month}`,
        types: TRANSACTION_TYPES.join(", "),
      });
    }

    const sourceResult = await dbQuery(
      `
        SELECT id
        FROM sources
        WHERE homepage_url = $1
           OR rss_url = $1
           OR sitemap_url = $1
        LIMIT 1
      `,
      ["https://www.nfl.com/transactions/"]
    );

    const sourceRows = sourceResult.rows as SourceRow[];
    const sourceId = sourceRows[0]?.id != null ? String(sourceRows[0].id) : null;

    let ingested = 0;

    for (const tx of allTransactions) {
      try {
        const transactionDate = parseTransactionDate(tx.date, year);
        if (!transactionDate) {
          continue;
        }

        const normalizedType = normalizeType(tx.type, tx.sourceType);
        const details = `${tx.teamFrom} → ${tx.teamTo}`;
        const sourceUrl = `https://www.nfl.com/transactions/league/${tx.sourceType}/${year}/${month}`;

        const insertResult = await dbQuery(
          `
            INSERT INTO transactions (
              source,
              source_url,
              source_id,
              transaction_date,
              team_key,
              team_name,
              player_name,
              position,
              transaction_type_raw,
              transaction_type_normalized,
              details
            )
            SELECT
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            WHERE NOT EXISTS (
              SELECT 1
              FROM transactions
              WHERE player_name = $7
                AND transaction_date = $4
                AND transaction_type_raw = $9
                AND source_url = $2
            )
            RETURNING id
          `,
          [
            "NFL.com Transactions",
            sourceUrl,
            sourceId,
            transactionDate,
            tx.teamToKey,
            tx.teamTo,
            tx.player,
            tx.position,
            tx.type,
            normalizedType,
            details,
          ]
        );

        const insertedRows = insertResult.rows as InsertRow[];
        if (insertedRows.length > 0) {
          ingested += 1;
        }
      } catch (error) {
        console.error("Failed to insert transaction:", {
          player: tx.player,
          date: tx.date,
          type: tx.type,
          error,
        });
      }
    }

    return NextResponse.json({
      success: true,
      total: allTransactions.length,
      ingested,
      yearMonth: `${year}/${month}`,
      types: TRANSACTION_TYPES.join(", "),
    });
  } catch (error) {
    console.error("Route error:", error);

    return NextResponse.json(
      {
        success: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}