// app/api/admin/sources/route.ts
import { dbQuery } from "@/lib/db";
import { z } from "zod";

// Validation for create/upsert
const upsertSchema = z.object({
  name: z.string().min(2).max(200),
  homepage_url: z.string().url().optional().or(z.literal("")),
  rss_url: z.string().url().optional().or(z.literal("")),
  favicon_url: z.string().url().optional().or(z.literal("")),
  sitemap_url: z.string().url().optional().or(z.literal("")),
  category: z
    .enum([
      "Fantasy News",
      "Rankings",
      "Start/Sit",
      "Injury",
      "DFS",
      "Dynasty",
      "Betting/DFS",
      "Podcast",
      "Team Site",
      "Other",
      "",
    ])
    .optional(),
  priority: z.coerce.number().int().min(0).max(9999).optional().default(0),
  allowed: z.coerce.boolean().optional().default(true),
});

// Validation for toggle
const toggleSchema = z.object({
  id: z.coerce.number().int(),
  allowed: z.coerce.boolean(),
});

// Helper to extract a useful error message from unknown
function getErrorMessage(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues.map((i) => i.message).join(", ");
  }
  if (typeof err === "object" && err && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Invalid input";
}

// GET: list latest sources
export async function GET() {
  try {
    const r = await dbQuery(
      `select id, name, homepage_url, rss_url, favicon_url, sitemap_url, category, allowed, priority
       from sources
       order by created_at desc
       limit 500`
    );
    return Response.json(r.rows);
  } catch (err: unknown) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 500 });
  }
}

// POST: upsert one source by name
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const v = upsertSchema.parse(body);

    const res = await dbQuery(
      `
      insert into sources (name, homepage_url, rss_url, favicon_url, sitemap_url, category, allowed, priority)
      values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (name)
      do update set
        homepage_url = excluded.homepage_url,
        rss_url      = excluded.rss_url,
        favicon_url  = excluded.favicon_url,
        sitemap_url  = excluded.sitemap_url,
        category     = excluded.category,
        allowed      = excluded.allowed,
        priority     = excluded.priority
      returning id
      `,
      [
        v.name.trim(),
        v.homepage_url || null,
        v.rss_url || null,
        v.favicon_url || null,
        v.sitemap_url || null,
        v.category || null,
        v.allowed ?? true,
        v.priority ?? 0,
      ]
    );

    return Response.json({ ok: true, id: res.rows[0].id });
  } catch (err: unknown) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 400 });
  }
}

// PATCH: toggle allowed
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const v = toggleSchema.parse(body);
    await dbQuery(`update sources set allowed=$2 where id=$1`, [v.id, v.allowed]);
    return Response.json({ ok: true });
  } catch (err: unknown) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 400 });
  }
}
