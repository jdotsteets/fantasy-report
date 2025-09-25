// app/api/social/drafts/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getIdFromUrl(req: Request): string {
  const { pathname } = new URL(req.url);
  const parts = pathname.replace(/\/+$/, "").split("/");
  return decodeURIComponent(parts[parts.length - 1] || "");
}

export async function GET(req: Request): Promise<Response> {
  const id = getIdFromUrl(req);
  return Response.json({ ok: true, id });
}

export async function PATCH(req: Request): Promise<Response> {
  const id = getIdFromUrl(req);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  // TODO: validate `body` and update draft
  return Response.json({ ok: true, id, body });
}
