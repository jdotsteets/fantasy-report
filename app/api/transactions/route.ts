import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ESPN_TEAM_IDS: Record<string, number> = {
  buf: 2, mia: 15, ne: 17, nyj: 20, bal: 33, cin: 4, cle: 5, pit: 23,
  hou: 34, ind: 11, jax: 30, ten: 10, den: 7, kc: 12, lv: 13, lac: 24,
  dal: 6, nyg: 19, phi: 21, wsh: 28, chi: 3, det: 8, gb: 9, min: 16,
  atl: 1, car: 29, no: 18, tb: 27, ari: 22, lar: 14, sf: 25, sea: 26,
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get("team");

  if (!teamId) {
    return NextResponse.json({ error: "team required" }, { status: 400 });
  }

  const espnId = ESPN_TEAM_IDS[teamId.toLowerCase()];
  if (!espnId) {
    return NextResponse.json({ error: "invalid team" }, { status: 400 });
  }

  try {
    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnId}/transactions`;
    const res = await fetch(espnUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return NextResponse.json({ transactions: [], count: 0 });
    }

    const data = await res.json();
    const transactions = (data.transactions || []).slice(0, 10).map((t: any, i: number) => ({
      id: t.id || `t-${i}`,
      date: t.date || new Date().toISOString(),
      type: getType(t.description || ""),
      description: t.description || t.headline || "Transaction",
    }));

    return NextResponse.json({ transactions, count: transactions.length });
  } catch {
    return NextResponse.json({ transactions: [], count: 0 });
  }
}

function getType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("sign")) return "SIGNING";
  if (lower.includes("trade")) return "TRADE";
  if (lower.includes("release") || lower.includes("waive")) return "RELEASE";
  if (lower.includes("draft")) return "DRAFT";
  return "OTHER";
}
