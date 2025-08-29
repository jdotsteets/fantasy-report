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
  scrape_selector: z.string().max(500).optional().or(z.literal("")),
  // keep your existing categories
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
  // optional sport (default nfl)
  sport: z.string().min(2).max(20).optional().default("nfl"),
  priority: z.coerce.number().int().min(0).max(9999).optional().default(0),
  allowed: z.coerce.boolean().optional().default(true),
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

// Small helpers shared by POST/PATCH
const toNullIfBlank = (v: unknown): string | null => {
  const t = (v ?? "").toString().trim();
  return t.length ? t : null;
};

const normalizeUrl = (v: unknown): string | null => {
  const raw = (v ?? "").toString().trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {}
  // accept bare domains/paths and coerce to https
  try {
    const u2 = new URL("https://" + raw.replace(/^\/*/, ""));
    if (u2.protocol === "http:" || u2.protocol === "https:") return u2.toString();
  } catch {}
  return raw;
};

// GET: list latest sources
export async function GET() {
  try {
    const r = await dbQuery(
      `select id, name, homepage_url, rss_url, scrape_selector, favicon_url, sitemap_url, category, sport, allowed, priority
       from sources
       order by created_at desc
       limit 500`
    );
    return Response.json(r.rows);
  } catch (err: unknown) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 500 });
  }
}

// POST: upsert one source by name (create if not exists, otherwise update)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const v = upsertSchema.parse(body);

    // Normalize inputs
    const homepage = normalizeUrl(v.homepage_url);
    const rss = normalizeUrl(v.rss_url);
    const favicon = normalizeUrl(v.favicon_url);
    const sitemap = normalizeUrl(v.sitemap_url);
    const selector = toNullIfBlank(v.scrape_selector);
    const sport = (v.sport || "nfl").toLowerCase();

    // Require at least one of homepage_url or rss_url
    if (!homepage && !rss) {
      return Response.json(
        { ok: false, error: "Either homepage_url or rss_url is required." },
        { status: 400 }
      );
    }

    const res = await dbQuery(
      `
      insert into sources
        (name, homepage_url, rss_url, scrape_selector, favicon_url, sitemap_url, category, sport, allowed, priority, created_at)
      values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
      on conflict (name)
      do update set
        homepage_url   = excluded.homepage_url,
        rss_url        = excluded.rss_url,
        scrape_selector= excluded.scrape_selector,
        favicon_url    = excluded.favicon_url,
        sitemap_url    = excluded.sitemap_url,
        category       = excluded.category,
        sport          = excluded.sport,
        allowed        = excluded.allowed,
        priority       = excluded.priority
      returning id
      `,
      [
        v.name.trim(),
        homepage,
        rss,
        selector,
        favicon,
        sitemap,
        v.category || null,
        sport,
        v.allowed ?? true,
        v.priority ?? 0,
      ]
    );

    return Response.json({ ok: true, id: res.rows[0].id });
  } catch (err: unknown) {
    return Response.json({ ok: false, error: getErrorMessage(err) }, { status: 400 });
  }
}

// PATCH: update source fields (allowed, homepage_url, rss_url, scrape_selector)
export async function PATCH(req: Request) {
  try {
    const body = await req.json();

    // Validate id
    const id = Number(body?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ ok: false, error: "invalid_id" }, { status: 400 });
    }

    // Build updates only for provided fields
    const updates: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(body, "allowed")) {
      updates.allowed = !!body.allowed;
    }
    if (Object.prototype.hasOwnProperty.call(body, "homepage_url")) {
      updates.homepage_url = normalizeUrl(body.homepage_url);
    }
    if (Object.prototype.hasOwnProperty.call(body, "rss_url")) {
      updates.rss_url = normalizeUrl(body.rss_url);
    }
    if (Object.prototype.hasOwnProperty.call(body, "scrape_selector")) {
      updates.scrape_selector = toNullIfBlank(body.scrape_selector);
    }
    if (Object.prototype.hasOwnProperty.call(body, "favicon_url")) {
      updates.favicon_url = normalizeUrl(body.favicon_url);
    }
    if (Object.prototype.hasOwnProperty.call(body, "sitemap_url")) {
      updates.sitemap_url = normalizeUrl(body.sitemap_url);
    }
    if (Object.prototype.hasOwnProperty.call(body, "category")) {
      updates.category = (body.category ?? null) as string | null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "sport")) {
      const s = (body.sport ?? "").toString().trim().toLowerCase();
      updates.sport = s || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "priority")) {
      const p = Number(body.priority);
      if (Number.isFinite(p)) updates.priority = p;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ ok: false, error: "no_fields_to_update" }, { status: 400 });
    }

    // Dynamic parameterized UPDATE
    const fields = Object.keys(updates);
    const setSql = fields.map((k, i) => `${k} = $${i + 1}`).join(", ");

    type SqlParam = string | number | boolean | Date | null;
    const params: SqlParam[] = fields.map((k) => updates[k] as SqlParam);
    params.push(id as SqlParam);

    await dbQuery(
      `UPDATE sources SET ${setSql} WHERE id = $${fields.length + 1}`,
      params
    );

    return Response.json({ ok: true });
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    return Response.json({ ok: false, error: msg }, { status: 400 });
  }
}
