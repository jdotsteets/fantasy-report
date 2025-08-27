// lib/x/client.ts
export type Tweet = {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  public_metrics: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    quote_count: number;
  };
};

export type User = {
  id: string;
  name: string;
  username: string;
  verified?: boolean;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
};

export type SearchPage = {
  data?: Tweet[];
  includes?: { users?: User[] };
  meta: { result_count: number; next_token?: string };
};

const BASE = "https://api.twitter.com/2/tweets/search/recent";

function authHeader(): HeadersInit {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("X_BEARER_TOKEN not set");
  return { Authorization: `Bearer ${token}` };
}

export type SearchOptions = {
  query: string;
  startTimeISO?: string; // inclusive
  maxResults?: number;   // 10..100
  nextToken?: string;
};

export async function searchRecent(opts: SearchOptions): Promise<SearchPage> {
  const u = new URL(BASE);
  u.searchParams.set("query", opts.query);
  u.searchParams.set("max_results", String(Math.min(Math.max(opts.maxResults ?? 100, 10), 100)));
  u.searchParams.set("tweet.fields", "created_at,public_metrics");
  u.searchParams.set("expansions", "author_id");
  u.searchParams.set("user.fields", "username,name,verified,public_metrics");
  if (opts.startTimeISO) u.searchParams.set("start_time", opts.startTimeISO);
  if (opts.nextToken) u.searchParams.set("next_token", opts.nextToken);

  const res = await fetch(u.toString(), { headers: authHeader() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API error ${res.status}: ${body}`);
  }
  return (await res.json()) as SearchPage;
}
