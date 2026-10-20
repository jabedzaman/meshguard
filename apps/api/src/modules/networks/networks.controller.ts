import { z } from "zod";
import { validate } from "~/lib/validator";
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

export const updateNetworkBody = z.object({
  /** New devices wait for an owner or admin to approve them. */
  deviceApproval: z.boolean().optional(),
  /** Days a key lasts; null: never expires. */
  keyExpiryDays: z.number().int().min(1).max(3650).nullable().optional(),
});

/** Changes the network's device policy. Owners and admins only. */
export const update = factory.createHandlers(
  requireOrganization,
  requirePermission({ network: ["update"] }),
  validate("json", updateNetworkBody),
  async (c) => {
    const network = await c.var.services.networks.updateSettings(
      c.var.organizationId,
      c.req.valid("json"),
    );
    return c.json(network, 200);
  },
);
