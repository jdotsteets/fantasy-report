// lib/waivers/extract.ts
import { dbQuery, dbQueryRows } from "@/lib/db";

type PlayerRow = {
  key: string;
  full_name: string | null;
  aliases: string[] | null;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRx(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// very light HTML -> text (good enough for matching)
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// pull “list-like” chunks to guess order/rank
function extractListyLines(html: string): string[] {
  const lines: string[] = [];
  const take = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      lines.push(stripHtml(m[1] || m[0]));
    }
  };
  take(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  take(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi);
  take(/<strong[^>]*>([\s\S]*?)<\/strong>/gi);
  // fallback to paragraphs (first ~40)
  let pm: RegExpExecArray | null;
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let i = 0;
  while (i < 40 && (pm = pRe.exec(html))) {
    const t = stripHtml(pm[1] || "");
    if (t) lines.push(t);
    i++;
  }
  return lines.slice(0, 120);
}

export async function extractWaiverMentions(articleId: number, url: string): Promise<number> {
  // 1) load players
  const players = await dbQueryRows<PlayerRow>(
    `select key, full_name, aliases from players where coalesce(active, true) = true`
  );

  // 2) fetch article
  let html = "";
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    // give up quietly; backfill continues
    return 0;
  }

  const bodyText = ` ${stripHtml(html)} `;
  const normBody = norm(bodyText);
  const lines = extractListyLines(html).map((s) => ` ${s} `);

  // 3) build alias map & match counts
  type Hit = { key: string; name: string; count: number; firstLineIdx: number | null };
  const hits: Record<string, Hit> = {};

  for (const p of players) {
    const aliases = new Set<string>();
    if (p.full_name) aliases.add(p.full_name);
    for (const a of p.aliases ?? []) if (a) aliases.add(a);
    // Add a couple light variants (first-initial last-name)
    if (p.full_name) {
      const parts = p.full_name.split(/\s+/);
      const last = parts[parts.length - 1];
      const first = parts[0];
      if (first && last) {
        aliases.add(`${first[0]}. ${last}`);
        aliases.add(`${first[0]} ${last}`);
      }
    }

    let total = 0;
    let firstLineIdx: number | null = null;
    let displayName = p.full_name || Array.from(aliases)[0] || p.key;

    for (const alias of aliases) {
      const a = alias.trim();
      if (!a || a.length < 3) continue;

      // whole-word match (case-insensitive) against raw body text
      const rx = new RegExp(`\\b${escapeRx(a)}\\b`, "gi");
      const localCount = (bodyText.match(rx) || []).length;
      total += localCount;

      if (firstLineIdx === null && localCount > 0) {
        // find earliest list-like line containing the alias
        for (let i = 0; i < lines.length; i++) {
          if (new RegExp(`\\b${escapeRx(a)}\\b`, "i").test(lines[i])) {
            firstLineIdx = i;
            break;
          }
        }
      }
    }

    if (total > 0) {
      hits[p.key] = {
        key: p.key,
        name: displayName,
        count: total,
        firstLineIdx,
      };
    }
  }

  const found = Object.values(hits);
  if (found.length === 0) return 0;

  // 4) compute rank_hint + confidence
  found.sort((a, b) => {
    const ai = a.firstLineIdx ?? 9_999;
    const bi = b.firstLineIdx ?? 9_999;
    if (ai !== bi) return ai - bi;
    return b.count - a.count;
  });

  const rows = found.map((h, idx) => {
    const rank = h.firstLineIdx != null ? idx + 1 : null;
    // simple confidence: 1 + log(count), boosted if we had a rank
    const conf = Math.round((1 + Math.log(1 + h.count)) * (rank ? 1.4 : 1.0) * 100) / 100;
    return { key: h.key, name: h.name, rank, conf };
  });

  // 5) insert (idempotent)
  // NOTE: ensure you created a unique index on (article_id, player_key)
  const valuesSql = rows
    .map(
      (_r, i) =>
        `($1::bigint, $${i * 4 + 2}, $${i * 4 + 3}, $4::text, $${i * 4 + 4}::int, $${i * 4 + 5}::numeric)`
    )
    .join(", ");

  const params: any[] = [articleId];
  for (const r of rows) {
    params.push(r.key, r.name, r.rank, r.conf);
  }
  // source_url constant param at $4 (shared for every row)
  params.splice(3, 0, url);

  await dbQuery(
    `
    INSERT INTO waiver_mentions
      (article_id, player_key, player_name, source_url, rank_hint, confidence)
    VALUES ${valuesSql}
    ON CONFLICT (article_id, player_key)
    DO UPDATE SET
      player_name = COALESCE(EXCLUDED.player_name, waiver_mentions.player_name),
      rank_hint   = COALESCE(waiver_mentions.rank_hint, EXCLUDED.rank_hint),
      confidence  = GREATEST(waiver_mentions.confidence, EXCLUDED.confidence)
    `,
    params
  );

  return rows.length;
}
