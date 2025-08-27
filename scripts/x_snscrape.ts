// scripts/x_snscrape.ts
// Usage (after activating your .sns venv):
//   npx tsx scripts/x_snscrape.ts --days=7 --max=400
// or explicitly:
//   SNSSCRAPE_BIN=.sns/bin/snscrape npx tsx scripts/x_snscrape.ts --days=7 --max=400
// Make sure this use complies with X’s ToS.

import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { dbQuery } from "@/lib/db";
import { parseRankingList } from "@/lib/x/parser";

type SnsUser = {
  username: string;
  displayname?: string;
  id?: string | number;
  followersCount?: number;
};

type SnsTweet = {
  id: string | number;
  url: string;
  date: string; // ISO
  content: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  user?: SnsUser;
};

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildQuery(): string {
  const must = [
    '"fantasy rankings" OR "top 10" OR "top 20" OR "my top" OR "must have" OR "must-have"',
    '(qb OR rb OR wr OR te OR flex OR superflex OR overall OR nfl OR "fantasy football")',
    "lang:en",
    "-filter:retweets",
  ];
  const notSports =
    "-mlb -nba -nhl -wnba -mls -soccer -premier -bundesliga -laliga -uefa -nascar -f1 -formula -motogp";
  return `${must.join(" ")} ${notSports}`;
}

function pickSnscrapeBin(): string {
  const fromEnv = process.env.SNSSCRAPE_BIN;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  // Prefer venv binary if available
  const which = spawnSync("which", ["snscrape"], { stdio: "pipe" });
  if (which.status === 0) {
    const p = String(which.stdout).trim();
    if (p) return p;
  }
  // Fallback: assume on PATH
  return "snscrape";
}

async function snscrapeSearch(
  query: string,
  sinceYMD: string,
  untilYMD: string,
  max: number
): Promise<SnsTweet[]> {
  const q = `${query} since:${sinceYMD} until:${untilYMD}`;
  const bin = pickSnscrapeBin();
  const args = ["--jsonl", "--max-results", String(max), "twitter-search", q];

  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

  const rl = createInterface({ input: child.stdout });
  const out: SnsTweet[] = [];

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));

  for await (const line of rl) {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const t: SnsTweet = {
      id: String(obj["id"]),
      url: String(obj["url"]),
      date: String(obj["date"]),
      content: String(obj["content"] ?? ""),
      likeCount: Number(obj["likeCount"] ?? 0),
      retweetCount: Number(obj["retweetCount"] ?? 0),
      replyCount: Number(obj["replyCount"] ?? 0),
      quoteCount: Number(obj["quoteCount"] ?? 0),
      user: obj["user"]
        ? {
            username: String((obj["user"] as Record<string, unknown>)["username"] ?? ""),
            displayname: (obj["user"] as Record<string, unknown>)["displayname"] as string | undefined,
            id: (obj["user"] as Record<string, unknown>)["id"] as string | number | undefined,
            followersCount: Number((obj["user"] as Record<string, unknown>)["followersCount"] ?? 0),
          }
        : undefined,
    };
    out.push(t);
  }

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
  });

  if (exitCode !== 0) {
    throw new Error(
      `snscrape exited with code ${exitCode}.\n` +
        `Bin: ${bin}\nArgs: ${args.join(" ")}\n` +
        `Tip: activate your venv and ensure ".sns/bin/snscrape" is first on PATH,\n` +
        `or run with SNSSCRAPE_BIN=.sns/bin/snscrape\n\nStderr:\n${stderr}`
    );
  }
  return out;
}

function weight(followers: number, likes: number, rts: number, quotes: number, replies: number): number {
  const wf = Math.log10(followers / 2000 + 1);
  const engage = likes + rts + quotes + replies;
  const we = Math.log10(engage / 5 + 1);
  return 1 + wf + we;
}

async function upsertTweet(t: SnsTweet, isList: boolean): Promise<void> {
  await dbQuery(
    `
    INSERT INTO x_posts (
      tweet_id, author_id, author_user, author_name, text, created_at,
      like_count, retweet_count, reply_count, quote_count, url, is_list, position_hint
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (tweet_id) DO UPDATE SET
      text = EXCLUDED.text,
      like_count = EXCLUDED.like_count,
      retweet_count = EXCLUDED.retweet_count,
      reply_count = EXCLUDED.reply_count,
      quote_count = EXCLUDED.quote_count,
      is_list = EXCLUDED.is_list
    `,
    [
      String(t.id),
      t.user?.id ? String(t.user.id) : null,
      t.user?.username ?? null,
      t.user?.displayname ?? null,
      t.content,
      new Date(t.date),
      t.likeCount ?? 0,
      t.retweetCount ?? 0,
      t.replyCount ?? 0,
      t.quoteCount ?? 0,
      t.url,
      isList,
      null,
    ]
  );
}

async function upsertItems(t: SnsTweet, items: ReturnType<typeof parseRankingList>): Promise<void> {
  await dbQuery("DELETE FROM x_rank_items WHERE tweet_id = $1", [String(t.id)]);
  const n = items.length;
  const w = weight(t.user?.followersCount ?? 0, t.likeCount ?? 0, t.retweetCount ?? 0, t.quoteCount ?? 0, t.replyCount ?? 0);

  for (const it of items) {
    const pts = Math.round((n - it.rank + 1) * w);
    await dbQuery(
      `INSERT INTO x_rank_items (tweet_id, player_name, position, item_rank, overall, points)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [String(t.id), it.player, it.position ?? null, it.rank, it.overall, pts]
    );
  }
}

async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.split("=");
    args.set(k.replace(/^--/, ""), v ?? "true");
  }
  const days = Math.min(Math.max(Number(args.get("days") ?? 7), 1), 7);
  const max = Math.min(Math.max(Number(args.get("max") ?? 300), 50), 1000);

  const query = buildQuery();
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

  const tweets = await snscrapeSearch(query, ymd(since), ymd(until), max);

  let parsed = 0;
  for (const t of tweets) {
    const items = parseRankingList(t.content);
    const isList = items.length > 0;
    await upsertTweet(t, isList);
    if (isList) {
      await upsertItems(t, items);
      parsed++;
    }
  }

  console.log(JSON.stringify({ searched: tweets.length, lists_parsed: parsed, days, max }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
