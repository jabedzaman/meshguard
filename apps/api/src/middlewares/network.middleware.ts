import { createMiddleware } from "hono/factory";
import type { Services } from "@meshguard/server-core";

/**
 * Exposes the active organization's network as c.var.networkId. An organization
 * has exactly one, so routes never name it. Use after requireOrganization.
 */
export const requireNetwork = createMiddleware<{
  Variables: { services: Services; organizationId: string; networkId: string };
}>(async (c, next) => {
  const network = await c.var.services.networks.current(c.var.organizationId);
  c.set("networkId", network.id);
  await next();
});
