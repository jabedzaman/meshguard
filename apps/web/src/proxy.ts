import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/lib/auth";
import { orgSlugFromHost, orgUrl, rootUrl } from "~/lib/org-host";
import { ADD_ACCOUNT_PARAM, REDIRECT_PARAM, safeRedirect, withRedirect } from "~/lib/redirect";

/** Reachable without a session. Signed-in users are sent to the app. */
const AUTH_ROUTES = new Set(["/sign-in", "/sign-up"]);

/** Need a session but not an active organization. */
function isOnboardingRoute(pathname: string) {
  return (
    pathname === "/organizations" ||
    pathname === "/organizations/create" ||
    pathname.startsWith("/invitations/")
  );
}

// All routing on auth state lives here; layouts and pages can assume a session
// and, outside onboarding, an active organization.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  const redirect = (path: string) => NextResponse.redirect(new URL(path, request.url));
  // Where the visitor was headed, so the auth and onboarding steps can return there.
  const destination = `${pathname}${request.nextUrl.search}`;

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  // On an organization's subdomain, which only serves its dashboard: sign-in,
  // sign-up and onboarding belong to the root domain, so there is one place to
  // sign up and the session is only ever created from there.
  const hostSlug = orgSlugFromHost(request.headers.get("host"));
  const toRoot = (path: string) =>
    NextResponse.redirect(rootUrl(path) ?? new URL("/", request.url));

  if (hostSlug && (AUTH_ROUTES.has(pathname) || isOnboardingRoute(pathname))) {
    return toRoot(destination);
  }

  if (!session) {
    if (AUTH_ROUTES.has(pathname)) return NextResponse.next();
    // Come back to this organization once signed in.
    const back = hostSlug ? orgUrl(hostSlug, destination) : destination;
    return hostSlug
      ? toRoot(withRedirect("/sign-in", back))
      : redirect(withRedirect("/sign-in", back));
  }

  if (AUTH_ROUTES.has(pathname)) {
    // Signed-in users can still reach these pages to add another account.
    return request.nextUrl.searchParams.has(ADD_ACCOUNT_PARAM)
      ? NextResponse.next()
      : redirect(safeRedirect(request.nextUrl.searchParams.get(REDIRECT_PARAM)));
  }

  // An organization's subdomain: the host must name an organization the user
  // belongs to, which then becomes the session's active one.
  if (hostSlug) {
    const organizations = await auth.api.listOrganizations({ headers: requestHeaders });
    const target = organizations.find((organization) => organization.slug === hostSlug);
    if (!target) return toRoot("/");
    return session.session.activeOrganizationId === target.id
      ? NextResponse.next()
      : redirect(
          withRedirect(`/api/organizations/${encodeURIComponent(target.id)}/activate`, destination),
        );
  }

  if (isOnboardingRoute(pathname)) return NextResponse.next();

  if (!session.session.activeOrganizationId) {
    const [first] = await auth.api.listOrganizations({ headers: requestHeaders });
    return redirect(
      withRedirect(
        first
          ? `/api/organizations/${encodeURIComponent(first.id)}/activate`
          : "/organizations/create",
        destination,
      ),
    );
  }

  // With subdomains on, the dashboard lives on the active organization's.
  if (!rootUrl()) return NextResponse.next();
  const active = (await auth.api.listOrganizations({ headers: requestHeaders })).find(
    (organization) => organization.id === session.session.activeOrganizationId,
  );
  const home = active && orgUrl(active.slug, destination);
  return home ? NextResponse.redirect(home) : NextResponse.next();
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
