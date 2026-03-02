// lib/zodBriefs.ts
import { z } from "zod";

export const BriefPayloadSchema = z.object({
  article_id: z.number().int().positive(),
  summary: z.string().min(30).max(600),
  why_matters: z.array(z.string().min(3).max(160)).min(1).max(2),
  seo_title: z.string().min(3).max(60).optional().nullable(),
  seo_description: z.string().min(20).max(160).optional().nullable(),
  status: z.enum(["draft","published","archived"]).optional(),
  slug: z.string().optional(), // auto if omitted
});
export type BriefPayload = z.infer<typeof BriefPayloadSchema>;
