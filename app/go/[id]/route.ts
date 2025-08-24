// app/go/[id]/route.ts
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(id: string | undefined): number | null {
  if (!id || id.trim() === "") return null;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> } // 👈 params is a Promise
) {
  // ✅ await params before using it
  const { id: idRaw } = await ctx.params;
  const id = parseId(idRaw);
  if (!id) return new Response("Missing or invalid id", { status: 400 });

  // look up destination URL
  const { rows } = await dbQuery<{ url: string }>(
    `select url
       from articles
      where id = $1
      limit 1`,
    [id]
  );
  if (rows.length === 0) return new Response("Not found", { status: 404 });

  const dest = rows[0].url;

  // fire‑and‑forget click logging (don’t block redirect on errors)
  try {
    const ref =
      req.headers.get("referer") ||
      req.headers.get("referrer") ||
      null;
    const ua = req.headers.get("user-agent") || null;
    const ip =
      (req.headers.get("x-forwarded-for") || "")
        .split(",")[0]
        .trim() || null;

    await dbQuery(
      `insert into clicks (article_id, ref, ua, ip)
       values ($1, $2, $3, $4)`,
      [id, ref, ua, ip]
    );
  } catch {
    // swallow logging errors
  }

  // 302 (Found) keeps it simple for external links
  return new Response(null, {
    status: 302,
    headers: {
      Location: dest,
      "Referrer-Policy": "no-referrer",
    },
  });
}
