// app/api/admin/sources/route.ts
import { dbQuery } from "@/lib/db";
import { z } from "zod";

/* ────────────────────────── schema ────────────────────────── */

const FETCH_MODE = z.enum(["auto", "rss", "adapter"]);

const upsertSchema = z.object({
  name: z.string().min(2).max(200),

  // URLs come as strings; we nullify blank below
  homepage_url: z.string().optional().default(""),
  rss_url: z.string().optional().default(""),
  favicon_url: z.string().optional().default(""),
  sitemap_url: z.string().optional().default(""),

  // optional hints for scrape
  scrape_path: z.string().optional().default(""),
  scrape_selector: z.string().optional().default(""),

  // misc
  category: z.string().optional().default(""),
  allowed: z.boolean().optional().default(true),
  paywall: z.boolean().optional().default(false),   // <— NEW
  priority: z.number().int().min(0).max(9999).optional().default(0),

  // adapter bits
  scraper_key: z.string().optional().default(""),
  adapter_config: z.record(z.string(), z.unknown()).optional().default({}),
  fetch_mode: FETCH_MODE.optional().default("auto"),
});

function toText(v: unknown): string | null {
  const s = (v ?? "").toString().trim();
  return s.length ? s : null;
}
function toJsonb(v: unknown): string | null {
  if (v == null) return null;
  try {
    return JSON.stringify(v); // pg will cast text -> jsonb
  } catch {
    return null;
  }
}
function getErrorMessage(err: unknown): string {
  if (err instanceof z.ZodError) return err.issues.map(i => i.message).join(", ");
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as any).message;
    if (typeof m === "string") return m;
  }
  return "Invalid input";
}

/* ────────────────────────── GET ────────────────────────── */

export async function GET() {
  try {
    const r = await dbQuery(
      `select id, name, homepage_url, rss_url, favicon_url, sitemap_url,
              scrape_path, scrape_selector, category, allowed, paywall, priority,
              scraper_key, adapter_config, fetch_mode
         from sources
        order by id desc
        limit 500`,
      []
    );
    return Response.json(r.rows);
  } catch (err) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 500 });
  }
}

/* ────────────────────────── POST (create) ────────────────────────── */

export async function POST(req: Request) {
  try {
    const body = upsertSchema.parse(await req.json());

    const params = [
      body.name,                      // $1  ::text
      toText(body.homepage_url),      // $2  ::text
      toText(body.rss_url),           // $3  ::text
      toText(body.favicon_url),       // $4  ::text
      toText(body.sitemap_url),       // $5  ::text
      toText(body.scrape_path),       // $6  ::text
      toText(body.scrape_selector),   // $7  ::text
      toText(body.category),          // $8  ::text
      !!body.allowed,                 // $9  ::boolean
      !!body.paywall,                 // $10 ::boolean   <-- NEW
      Number(body.priority) || 0,     // $11 ::integer
      toText(body.scraper_key),       // $12 ::text
      toJsonb(body.adapter_config),   // $13 ::jsonb
      body.fetch_mode,                // $14 ::text
    ];

    const sql = `
      insert into sources (
        name, homepage_url, rss_url, favicon_url, sitemap_url,
        scrape_path, scrape_selector, category, allowed, paywall, priority,
        scraper_key, adapter_config, fetch_mode
      )
      values (
        $1::text,  $2::text,  $3::text,  $4::text,  $5::text,
        $6::text,  $7::text,  $8::text,  $9::boolean, COALESCE($10::boolean, false), $11::integer,
        $12::text, $13::jsonb, $14::text
      )
      returning id
    `;

    const r = await dbQuery(sql, params);
    return Response.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 400 });
  }
}

/* ────────────────────────── PATCH (partial update) ────────────────────────── */

export async function PATCH(req: Request) {
  try {
    const raw = await req.json();
    const id = Number(raw?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ ok: false, error: "invalid_id" }, { status: 400 });
    }

    const updates: Record<string, any> = {};

    if ("name" in raw) updates.name = toText(raw.name);
    if ("homepage_url" in raw) updates.homepage_url = toText(raw.homepage_url);
    if ("rss_url" in raw) updates.rss_url = toText(raw.rss_url);
    if ("favicon_url" in raw) updates.favicon_url = toText(raw.favicon_url);
    if ("sitemap_url" in raw) updates.sitemap_url = toText(raw.sitemap_url);
    if ("scrape_path" in raw) updates.scrape_path = toText(raw.scrape_path);
    if ("scrape_selector" in raw) updates.scrape_selector = toText(raw.scrape_selector);
    if ("category" in raw) updates.category = toText(raw.category);
    if ("allowed" in raw) updates.allowed = !!raw.allowed;
    if ("paywall" in raw) updates.paywall = !!raw.paywall;            // <— NEW
    if ("priority" in raw) updates.priority = Number(raw.priority) || 0;
    if ("scraper_key" in raw) updates.scraper_key = toText(raw.scraper_key);
    if ("adapter_config" in raw) updates.adapter_config = toJsonb(raw.adapter_config);
    if ("fetch_mode" in raw) updates.fetch_mode = toText(raw.fetch_mode);

    if (Object.keys(updates).length === 0) {
      return Response.json({ ok: false, error: "no_fields_to_update" }, { status: 400 });
    }

    const fields = Object.keys(updates);
    const casts: Record<string, string> = {
      name: "::text",
      homepage_url: "::text",
      rss_url: "::text",
      favicon_url: "::text",
      sitemap_url: "::text",
      scrape_path: "::text",
      scrape_selector: "::text",
      category: "::text",
      allowed: "::boolean",
      paywall: "::boolean",                 // <— NEW
      priority: "::integer",
      scraper_key: "::text",
      adapter_config: "::jsonb",
      fetch_mode: "::text",
    };

    const setSql = fields.map((k, i) => `${k} = $${i + 1}${casts[k] ?? ""}`).join(", ");
    const params = fields.map(k => updates[k]);
    params.push(id);

    const sql = `update sources set ${setSql} where id = $${fields.length + 1}::integer`;
    await dbQuery(sql, params);

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 400 });
  }
}
