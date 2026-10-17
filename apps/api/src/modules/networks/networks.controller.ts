import { factory } from "~/lib/factory";
import { requireOrganization, requirePermission } from "~/middlewares/auth.middleware";

export const get = factory.createHandlers(
  requireOrganization,
  requirePermission({ network: ["read"] }),
  async (c) => {
    const network = await c.var.services.networks.current(c.var.organizationId);
    return c.json(network, 200);
  },
);
