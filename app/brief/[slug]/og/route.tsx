// app/brief/[slug]/og/route.tsx
import { ImageResponse } from "next/og";
import { getBriefBySlug } from "@/lib/briefs";

export const runtime = "nodejs";

const size = { width: 1200, height: 630 };

type RouteParams = { slug: string };

export async function GET(
  _req: Request,
  ctx: { params: Promise<RouteParams> } // 👈 params is a Promise in Next 15
) {
  const { slug } = await ctx.params;     // 👈 await it
  const brief = await getBriefBySlug(slug);

  const title =
    brief?.seo_title ?? brief?.article_title ?? "The Fantasy Report";
  const sub = (brief?.summary ?? "").replace(/\s+/g, " ").slice(0, 180);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 64,
          background: "white",
          color: "black",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>
          {title}
        </div>
        {sub && (
          <div style={{ marginTop: 20, fontSize: 28, opacity: 0.8 }}>
            {sub}
          </div>
        )}
      </div>
    ),
    size
  );
}
