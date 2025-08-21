// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const adminPath = req.nextUrl.pathname.startsWith("/admin");
  if (!adminPath) return NextResponse.next();

  const token = process.env.ADMIN_TOKEN; // set this in your .env
  if (!token) return NextResponse.next(); // no token -> don't block

  // If cookie already present, allow
  const cookie = req.cookies.get("admin")?.value;
  if (cookie === token) return NextResponse.next();

  // If ?key= is provided and correct, set cookie and strip the query param
  const key = req.nextUrl.searchParams.get("key");
  if (key && key === token) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("key");
    const res = NextResponse.redirect(url);
    res.cookies.set("admin", token, { httpOnly: true, path: "/" });
    return res;
  }

  // Otherwise block with a minimal prompt
  return new NextResponse(
    "Unauthorized. Append ?key=YOUR_ADMIN_TOKEN once to unlock.",
    { status: 401 }
  );
}

export const config = {
  matcher: ["/admin/:path*"],
};
