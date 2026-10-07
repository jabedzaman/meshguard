import { factory } from "~/lib/factory";
import { validate } from "~/lib/validator";
import { requireOrganization, requirePermission } from "~/middlewares/auth.middleware";
import { createServiceBody, setServiceHostsBody } from "~/modules/services/services.schema";
import { idParams, networkIdParams } from "~/schemas/params.schema";

export const list = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["read"] }),
  validate("param", networkIdParams),
  async (c) => {
    const services = await c.var.services.services.list(
      c.var.organizationId,
      c.req.valid("param").networkId,
    );
    return c.json(services, 200);
  },
);

/** Creating a service and choosing its hosts sends other people's traffic to those devices: owners and admins only. */
export const create = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["update"] }),
  validate("param", networkIdParams),
  validate("json", createServiceBody),
  async (c) => {
    const service = await c.var.services.services.create(
      c.var.organizationId,
      c.req.valid("param").networkId,
      c.req.valid("json"),
    );
    return c.json(service, 201);
  },
);

export const setHosts = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["update"] }),
  validate("param", idParams),
  validate("json", setServiceHostsBody),
  async (c) => {
    await c.var.services.services.setHosts(
      c.var.organizationId,
      c.req.valid("param").id,
      c.req.valid("json").hostDeviceIds,
    );
    return c.body(null, 204);
  },
);

export const remove = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["update"] }),
  validate("param", idParams),
  async (c) => {
    await c.var.services.services.remove(c.var.organizationId, c.req.valid("param").id);
    return c.body(null, 204);
  },
);
