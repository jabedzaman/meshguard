import { factory } from "~/lib/factory";
import { validate } from "~/lib/validator";
import { requireOrganization, requirePermission } from "~/middlewares/auth.middleware";
import { enrollDeviceBody } from "~/modules/devices/devices.schema";
import { networkIdParams } from "~/schemas/params.schema";

/** Called by the agent (`mesh up --token ...`); authenticated by the enrollment token. */
export const enroll = factory.createHandlers(validate("json", enrollDeviceBody), async (c) => {
  const result = await c.var.services.devices.enroll(c.req.valid("json"));
  return c.json(result, 201);
});

export const listForNetwork = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["read"] }),
  validate("param", networkIdParams),
  async (c) => {
    const devices = await c.var.services.devices.listForNetwork(
      c.var.organizationId,
      c.req.valid("param").networkId,
    );
    return c.json(devices, 200);
  },
);
