import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

const SPORTSDATA_API_KEY = process.env.SPORTSDATA_API_KEY || "813f776986d7493ea4bd2be07e5e59ba";

export async function POST(request: Request) {
  try {
    // Fetch all players from SportsData.io
    const response = await fetch(
      `https://api.sportsdata.io/v3/nfl/scores/json/Players?key=${SPORTSDATA_API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error(`SportsData.io returned ${response.status}`);
    }

    const players = await response.json();
    
    let updated = 0;
    let inserted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const p of players) {
      try {
        // Map SportsData fields to our schema
        const searchNames = [
          `${p.FirstName} ${p.LastName}`.trim(),
          p.LastName,
          p.ShortName,
        ].filter(Boolean);

        await dbQuery(
          `INSERT INTO players (
            player_id, full_name, first_name, last_name, position, team, active,
            search_names, birth_date, height, weight, college, years_exp,
            gsis_id, pfr_id, espn_id, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          ON CONFLICT (player_id) 
          DO UPDATE SET
            full_name = EXCLUDED.full_name,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            position = EXCLUDED.position,
            team = EXCLUDED.team,
            active = EXCLUDED.active,
            search_names = EXCLUDED.search_names,
            birth_date = EXCLUDED.birth_date,
            height = EXCLUDED.height,
            weight = EXCLUDED.weight,
            college = EXCLUDED.college,
            years_exp = EXCLUDED.years_exp,
            gsis_id = EXCLUDED.gsis_id,
            pfr_id = EXCLUDED.pfr_id,
            espn_id = EXCLUDED.espn_id,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted`,
          [
            p.PlayerID.toString(),
            `${p.FirstName} ${p.LastName}`.trim(),
            p.FirstName,
            p.LastName,
            p.Position,
            p.Team || null,
            p.Status === 'Active',
            searchNames,
            p.BirthDateString || null,
            p.Height ? parseInt(p.Height) : null,
            p.Weight ? parseInt(p.Weight) : null,
            p.College || null,
            p.Experience ? parseInt(p.Experience) : null,
            p.GlobalTeamID || null,
            p.PhotoUrl || null,
            p.PlayerID.toString(),
          ]
        );

        if (p.Status === 'Active') {
          updated++;
        } else {
          inserted++;
        }
      } catch (error) {
        failed++;
        errors.push(`${p.FirstName} ${p.LastName}: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    return NextResponse.json({
      success: true,
      total: players.length,
      updated,
      inserted,
      failed,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error("Player sync failed:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}