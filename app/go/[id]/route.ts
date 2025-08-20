// app/go/[id]/route.ts
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// pull the numeric id safely from the opaque Next context
function readId(ctx: unknown): number | null {
  try {
    const raw = (ctx as { params?: { id?: string } })?.params?.id;
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** @ts-expect-error Next.js wants the 2nd param untyped; we narrow inside */
export async function GET(req: Request, ctx) {
  const id = readId(ctx);
  if (!id) {
    return new Response("Missing or invalid id", { status: 400 });
  }

  // look up destination URL
  const { rows } = await query<{ url: string }>(
    `select url
       from articles
      where id = $1
      limit 1`,
    [id]
  );

  if (rows.length === 0) {
    return new Response("Not found", { status: 404 });
  }

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

    await query(
      `insert into clicks (article_id, ref, ua, ip)
       values ($1, $2, $3, $4)`,
      [id, ref, ua, ip]
    );
  } catch {
    // swallow logging errors
  }

  // do the redirect
  return new Response(null, {
    status: 302,
    headers: {
      Location: dest,
      // keep it privacy‑friendly
      "Referrer-Policy": "no-referrer",
    },
  });
}
