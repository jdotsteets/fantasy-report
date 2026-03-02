//appt/src/types.ts
export type Platform = "x" | "threads" | "tiktok" | "reels" | "instagram" | "facebook" | "shorts";
export type PostStatus = "draft" | "approved" | "scheduled" | "published" | "failed";

export interface Topic {
  id: string;              // article id
  title: string;
  url: string;
  source: string;          // provider name
  publishedAt: string;     // ISO
  primaryTopic?: string | null;
  staticType?: string | null;
  isPlayerPage?: boolean | null;
  week?: number | null;
  sport?: string | null;
  stat?: string | null;
  angle?: string | null;

}

export interface Draft {
  id: string;
  platform: Platform;
  hook: string;
  body: string;
  cta?: string;
  mediaPath?: string;
  link?: string;
  status: PostStatus;
  scheduledFor?: string;
  topicRef: string;        // article id
}

export interface Metrics {
  id: string;
  platform: Platform;
  postId: string;
  impressions: number;
  clicks?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  viewDurationMs?: number;
}
