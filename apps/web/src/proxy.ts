import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_ROUTES = new Set(["/sign-in", "/sign-up"]);

// Server-side URL of the API. Inside Docker this is the service name, which
// the browser can't reach, so it's separate from NEXT_PUBLIC_API_URL.
const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function hasSession(cookie: string | null): Promise<boolean> {
  if (!cookie) return false;
  try {
    const res = await fetch(`${API_URL}/api/auth/get-session`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return body !== null;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  const signedIn = await hasSession(request.headers.get("cookie"));

  if (!signedIn && !PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.redirect(
      new URL(`/sign-in?redirectTo=${encodeURIComponent(pathname)}`, request.url),
    );
  }

  if (signedIn && PUBLIC_ROUTES.has(pathname)) {
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
