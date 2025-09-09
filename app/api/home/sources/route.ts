// app/api/home/sources/route.ts
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nonTeam = url.searchParams.get("nonTeam");

  const rows = await dbQuery(
    `
    select id, name, homepage_url, favicon_url, category
    from sources
    where homepage_url is not null
      and (allowed is distinct from false)
      -- optional: filter out team categories (team, team site, etc.)
      and (
        $1::boolean is distinct from true
        or coalesce(lower(category),'') not like '%team%'
      )
    order by name asc
    `,
    [nonTeam === "1"]
  );

  return Response.json(rows.rows);
}
