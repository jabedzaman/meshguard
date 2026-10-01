import { headers as getHeaders } from "next/headers";
import type { NextRequest } from "next/server";
import { auth } from "~/lib/auth";

// Relative Location so the browser resolves it against the URL it used.
// Route handlers see the server's bind address (http://0.0.0.0:3000 in
// Docker) in request.url/nextUrl, and redirecting there drops the cookie.
function redirect(path: string, setCookies: string[] = []) {
  const headers = new Headers({ Location: path });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 307, headers });
}

// Falls back to the given organization when the session's active org is unset
// or no longer exists. Better Auth rejects organizations the user isn't a
// member of.
export async function GET(request: NextRequest) {
  const headers = await getHeaders();
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  const session = await auth.api.getSession({ headers });

  if (!session) return redirect("/sign-in");
  if (!organizationId) return redirect("/organizations/create");

  const setActiveResponse = await auth.api
    .setActiveOrganization({ headers, body: { organizationId }, asResponse: true })
    .catch(() => null);

  if (!setActiveResponse?.ok) return redirect("/organizations/create");
  return redirect("/", setActiveResponse.headers.getSetCookie());
}
