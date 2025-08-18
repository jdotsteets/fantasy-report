// app/go/[id]/route.ts
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

// Best-effort client IP extraction (works on Vercel)
function getClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "";
}

export async function GET(req: Request, ctx: Ctx) {
  const id = Number(ctx.params?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return new Response("Invalid id", { status: 400 });
  }

  // 1) Resolve URL
  const { rows } = await query<{ url: string }>(
    `select url from articles where id = $1`,
    [id]
  );

  if (rows.length === 0) {
    // If article not found, bounce to home
    return Response.redirect("/", 302);
  }
  const dest = rows[0].url;

  // 2) Fire-and-forget click log (we await once; if it fails, we still redirect)
  try {
    const ref = req.headers.get("referer") || "";
    const ua = req.headers.get("user-agent") || "";
    const ip = getClientIp(req);

    await query(
      `insert into clicks(article_id, clicked_at, ref, ua, ip)
       values ($1, now(), $2, $3, nullif($4,'')::inet)`,
      [id, ref, ua, ip]
    );
  } catch (e) {
    // Don't block the user if logging fails
    console.warn("click log failed:", e);
  }

  // 3) Off you go
  return Response.redirect(dest, 302);
}
