import { factory } from "~/lib/factory";
import { validate } from "~/lib/validator";
import { requireOrganization, requirePermission } from "~/middlewares/auth.middleware";
import { createConnectorBody, updateConnectorBody } from "~/modules/connectors/connectors.schema";
import { idParams, networkIdParams } from "~/schemas/params.schema";

export const list = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["read"] }),
  validate("param", networkIdParams),
  async (c) => {
    const connectors = await c.var.services.connectors.list(
      c.var.organizationId,
      c.req.valid("param").networkId,
    );
    return c.json(connectors, 200);
  },
);

/** A host resolves for and routes its peers' traffic: owners and admins only. */
export const create = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["update"] }),
  validate("param", networkIdParams),
  validate("json", createConnectorBody),
  async (c) => {
    const connector = await c.var.services.connectors.create(
      c.var.organizationId,
      c.req.valid("param").networkId,
      c.req.valid("json"),
    );
    return c.json(connector, 201);
  },
);

export const update = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["update"] }),
  validate("param", idParams),
  validate("json", updateConnectorBody),
  async (c) => {
    await c.var.services.connectors.update(
      c.var.organizationId,
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return c.body(null, 204);
  },
);

export const remove = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["update"] }),
  validate("param", idParams),
  async (c) => {
    await c.var.services.connectors.remove(c.var.organizationId, c.req.valid("param").id);
    return c.body(null, 204);
  },
);
