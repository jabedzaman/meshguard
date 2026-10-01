import { type NextRequest, NextResponse } from "next/server";
import { serverAuthClient } from "~/lib/auth-server";

const PUBLIC_ROUTES = new Set(["/sign-in", "/sign-up"]);

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/+$/, "") || "/";

  // Treat an unreachable API as signed out rather than failing the request.
  const { data: session } = await serverAuthClient
    .getSession({ fetchOptions: { headers: { cookie: request.headers.get("cookie") ?? "" } } })
    .catch(() => ({ data: null }));

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
