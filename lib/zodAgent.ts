// lib/zodAgent.ts
import { z } from "zod";

export const WriterJsonSchema = z.object({
  brief: z.string().min(30).max(600),
  why_matters: z.array(z.string().min(3).max(160)).min(1).max(2),
  seo: z.object({
    title: z.string().min(3).max(60),
    meta_description: z.string().min(20).max(160),
  }),
  cta_label: z.string().min(8).max(80),
  tone: z.literal("neutral-informative"),
});
export type WriterJson = z.infer<typeof WriterJsonSchema>;
