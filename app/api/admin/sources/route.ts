import { dbQuery } from "@/lib/db";
import { z } from "zod";

// + include scrape_path (optional, allow relative or absolute)
const upsertSchema = z.object({
  name: z.string().min(2).max(200),
  homepage_url: z.string().url().optional().or(z.literal("")),
  rss_url: z.string().url().optional().or(z.literal("")),
  favicon_url: z.string().url().optional().or(z.literal("")),
  sitemap_url: z.string().url().optional().or(z.literal("")),
  scrape_path: z.string().min(1).max(500).optional().or(z.literal("")), // <—
  category: z.enum([
    "Fantasy News","Rankings","Start/Sit","Injury","DFS","Dynasty",
    "Betting/DFS","Podcast","Team Site","Other","",
  ]).optional(),
  priority: z.coerce.number().int().min(0).max(9999).optional().default(0),
  allowed: z.coerce.boolean().optional().default(true),
});

function getErrorMessage(err: unknown): string {
  if (err instanceof z.ZodError) return err.issues.map(i => i.message).join(", ");
  if (typeof err === "object" && err && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Invalid input";
}

await dbQuery("select 1");

// GET now returns scrape_path too
export async function GET() {
  try {
    const r = await dbQuery(
      `select id, name, homepage_url, rss_url, scrape_selector, scrape_path,
              favicon_url, sitemap_url, category, allowed, priority
         from sources
        order by created_at desc
        limit 500`
    );
    return Response.json(r.rows);
  } catch (err: unknown) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const v = upsertSchema.parse(await req.json());
    const res = await dbQuery(
      `
      insert into sources
        (name, homepage_url, rss_url, favicon_url, sitemap_url, scrape_path,
         category, allowed, priority)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (name) do update set
        homepage_url = excluded.homepage_url,
        rss_url      = excluded.rss_url,
        favicon_url  = excluded.favicon_url,
        sitemap_url  = excluded.sitemap_url,
        scrape_path  = excluded.scrape_path,
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
        v.scrape_path || null,           // <—
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

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const id = Number(body?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ ok: false, error: "invalid_id" }, { status: 400 });
    }

    const toNullIfBlank = (v: unknown) => {
      const t = (v ?? "").toString().trim();
      return t.length ? t : null;
    };
    const normalizeUrl = (v: unknown): string | null => {
      const raw = (v ?? "").toString().trim();
      if (!raw) return null;
      try { const u = new URL(raw); if (/^https?:$/.test(u.protocol)) return u.toString(); } catch {}
      try { const u2 = new URL("https://" + raw.replace(/^\/*/, "")); if (/^https?:$/.test(u2.protocol)) return u2.toString(); } catch {}
      return raw;
    };

    const updates: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(body, "allowed")) updates.allowed = !!body.allowed;
    if (Object.prototype.hasOwnProperty.call(body, "homepage_url")) updates.homepage_url = normalizeUrl(body.homepage_url);
    if (Object.prototype.hasOwnProperty.call(body, "rss_url")) updates.rss_url = normalizeUrl(body.rss_url);
    if (Object.prototype.hasOwnProperty.call(body, "scrape_selector")) updates.scrape_selector = toNullIfBlank(body.scrape_selector);
    if (Object.prototype.hasOwnProperty.call(body, "scrape_path")) updates.scrape_path = toNullIfBlank(body.scrape_path); // <—

    if (Object.keys(updates).length === 0) {
      return Response.json({ ok: false, error: "no_fields_to_update" }, { status: 400 });
    }

    const fields = Object.keys(updates);
    const setSql = fields.map((k, i) => `${k} = $${i + 1}`).join(", ");
    type SqlParam = string | number | boolean | Date | null;
    const params: SqlParam[] = fields.map(k => updates[k] as SqlParam);
    params.push(id as SqlParam);

    await dbQuery(`update sources set ${setSql} where id = $${fields.length + 1}`, params);
    return Response.json({ ok: true });
  } catch (err: unknown) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 400 });
  }
}
