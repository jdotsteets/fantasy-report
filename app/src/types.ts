// src/types.ts
export type Platform = "x" | "threads" | "tiktok" | "reels" | "shorts";
export type PostStatus = "draft" | "approved" | "scheduled" | "published" | "failed";

export interface Topic {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  stat?: string;
  angle?: string;   // “usage spike”, “injury hedge”, etc.
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
  scheduledFor?: string; // ISO
  topicRef: string;      // Topic.id
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
  viewDurationMs?: number; // short video
}
