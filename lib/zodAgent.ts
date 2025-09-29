import { z } from "zod";

export const WriterJsonSchema = z.object({
  brief: z.string().min(20).max(1200),
  why_matters: z.array(z.string().min(6).max(140)).min(1).max(2),
  seo: z.object({
    title: z.string().min(3).max(120),
    meta_description: z.string().min(10).max(240),
  }),
  cta_label: z.string().min(5).max(120).optional(),
  tone: z.union([z.literal("neutral-informative"), z.literal("neutral")]),
});
export type WriterJson = z.infer<typeof WriterJsonSchema>;