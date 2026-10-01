import { createMiddleware } from "hono/factory";
import type { Auth, Session, User } from "@mesh/auth";
import { BadRequestError, UnauthorizedError } from "@mesh/server-core";
import type { AppEnv } from "~/types";

/** Resolves the Better Auth session (if any) from the request cookies. */
export function sessionMiddleware(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", result?.user ?? null);
    c.set("session", result?.session ?? null);
    await next();
  });
}

export const requireAuth = createMiddleware<{
  Variables: { user: User; session: Session };
}>(async (c, next) => {
  if (!c.get("session")) throw new UnauthorizedError();
  await next();
});

/**
 * Requires a session with an active organization and exposes its id as
 * c.var.organizationId. Better Auth only sets activeOrganizationId for
 * organizations the user is a member of.
 */
export const requireOrganization = createMiddleware<{
  Variables: { user: User; session: Session; organizationId: string };
}>(async (c, next) => {
  const session = c.get("session");
  if (!session) throw new UnauthorizedError();
  if (!session.activeOrganizationId) {
    throw new BadRequestError("no_active_organization", "Select an organization first");
  }
  c.set("organizationId", session.activeOrganizationId);
  await next();
});
