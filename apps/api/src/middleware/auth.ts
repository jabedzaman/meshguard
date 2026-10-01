import { createMiddleware } from "hono/factory";
import type { Auth } from "@mesh/auth";
import type { AppEnv, AuthedEnv } from "~/env";

/** Resolves the Better Auth session (if any) from the request cookies. */
export function sessionMiddleware(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("user", result?.user ?? null);
    c.set("session", result?.session ?? null);
    await next();
  });
}

export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  if (!c.get("session")) return c.json({ error: "unauthorized" }, 401);
  await next();
});
