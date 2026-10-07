import { createMiddleware } from "hono/factory";
import { TooManyRequestsError } from "@meshguard/server-core";
import { clientIp } from "~/lib/client-ip";
import type { AppEnv } from "~/types";

/** Allows `limit` requests per `windowMs` from one client address to the routes under this `name`. */
export function rateLimitByIp(name: string, limit: number, windowMs: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { allowed, retryAfter } = await c.var.services.rateLimiter.hit(
      name,
      clientIp(c),
      limit,
      windowMs,
    );
    if (!allowed) throw new TooManyRequestsError(retryAfter);
    await next();
  });
}
