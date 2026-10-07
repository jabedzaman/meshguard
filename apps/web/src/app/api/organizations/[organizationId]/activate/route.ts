import { headers as getHeaders } from "next/headers";
import { auth } from "~/lib/auth";
import { REDIRECT_PARAM, safeRedirect, withRedirect } from "~/lib/redirect";

// Relative Location so the browser resolves it against the URL it used.
// Route handlers see the server's bind address (http://0.0.0.0:3000 in
// Docker) in request.url/nextUrl, and redirecting there drops the cookie.
function redirect(path: string, setCookies: string[] = []) {
  const headers = new Headers({ Location: path });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 307, headers });
}

// Makes the organization the session's active one, then returns to the app.
// Used by the proxy when the session has no active organization; ?redirectTo= is where to land. Better
// Auth rejects organizations the user isn't a member of.
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/organizations/[organizationId]/activate">,
) {
  const { organizationId } = await params;
  const destination = safeRedirect(new URL(request.url).searchParams.get(REDIRECT_PARAM));
  const headers = await getHeaders();
  const session = await auth.api.getSession({ headers });

  if (!session) return redirect(withRedirect("/sign-in", destination));

  const setActiveResponse = await auth.api
    .setActiveOrganization({ headers, body: { organizationId }, asResponse: true })
    .catch(() => null);

  if (!setActiveResponse?.ok) return redirect(withRedirect("/organizations/create", destination));
  return redirect(destination, setActiveResponse.headers.getSetCookie());
}
