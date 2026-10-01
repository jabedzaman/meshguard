import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/lib/auth";

/** Reachable without a session. Signed-in users are sent to the app. */
const AUTH_ROUTES = new Set(["/sign-in", "/sign-up"]);

/** Need a session but not an active organization. */
const ONBOARDING_ROUTES = new Set(["/organizations/create"]);

// All routing on auth state lives here; layouts and pages can assume a session
// and, outside onboarding, an active organization.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  const redirect = (path: string) => NextResponse.redirect(new URL(path, request.url));

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    return AUTH_ROUTES.has(pathname)
      ? NextResponse.next()
      : redirect(`/sign-in?redirectTo=${encodeURIComponent(pathname)}`);
  }

  if (AUTH_ROUTES.has(pathname)) return redirect("/");
  if (ONBOARDING_ROUTES.has(pathname)) return NextResponse.next();

  if (!session.session.activeOrganizationId) {
    const [first] = await auth.api.listOrganizations({ headers: requestHeaders });
    return redirect(
      first
        ? `/api/organizations/${encodeURIComponent(first.id)}/activate`
        : "/organizations/create",
    );
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
