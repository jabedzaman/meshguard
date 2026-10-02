import { factory } from "~/lib/factory";
import { validate } from "~/lib/validator";
import { requireOrganization } from "~/middlewares/auth.middleware";
import { createNetworkBody } from "~/modules/networks/networks.schema";
import { idParams } from "~/schemas/params.schema";

export const list = factory.createHandlers(requireOrganization, async (c) => {
  const networks = await c.var.services.networks.list(c.var.organizationId);
  return c.json(networks, 200);
});

export const get = factory.createHandlers(
  requireOrganization,
  validate("param", idParams),
  async (c) => {
    const { id } = c.req.valid("param");
    const network = await c.var.services.networks.get(c.var.organizationId, id);
    return c.json(network, 200);
  },
);

export const create = factory.createHandlers(
  requireOrganization,
  validate("json", createNetworkBody),
  async (c) => {
    const network = await c.var.services.networks.create(c.var.organizationId, c.req.valid("json"));
    return c.json(network, 201);
  },
);
