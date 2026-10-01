import { headers as getHeaders } from "next/headers";
import { auth } from "~/lib/auth";

// Relative Location so the browser resolves it against the URL it used.
// Route handlers see the server's bind address (http://0.0.0.0:3000 in
// Docker) in request.url/nextUrl, and redirecting there drops the cookie.
function redirect(path: string, setCookies: string[] = []) {
  const headers = new Headers({ Location: path });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 307, headers });
}

// Makes the organization the session's active one, then returns to the app.
// Used by the app layout when the session has no active organization. Better
// Auth rejects organizations the user isn't a member of.
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/organizations/[organizationId]/activate">,
) {
  const { organizationId } = await params;
  const headers = await getHeaders();
  const session = await auth.api.getSession({ headers });

  if (!session) return redirect("/sign-in");

  const setActiveResponse = await auth.api
    .setActiveOrganization({ headers, body: { organizationId }, asResponse: true })
    .catch(() => null);

  if (!setActiveResponse?.ok) return redirect("/organizations/create");
  return redirect("/", setActiveResponse.headers.getSetCookie());
}
