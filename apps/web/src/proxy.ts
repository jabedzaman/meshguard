import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/lib/auth";

const PUBLIC_ROUTES = new Set(["/sign-in", "/sign-up"]);

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/+$/, "") || "/";

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session && !PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.redirect(
      new URL(`/sign-in?redirectTo=${encodeURIComponent(pathname)}`, request.url),
    );
  }

  if (session && PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except for:
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. all root files inside /public (e.g. /favicon.ico)
     */
    "/((?!api|_next|[\\w-]+\\.\\w+).*)",
  ],
};
