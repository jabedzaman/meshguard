import { factory } from "~/lib/factory";
import { validate } from "~/lib/validator";
import { requireOrganization, requirePermission } from "~/middlewares/auth.middleware";
import { requireDevice } from "~/middlewares/device.middleware";
import { enrollDeviceBody, syncDeviceBody } from "~/modules/devices/devices.schema";
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

/**
 * Called by the agent every few seconds (signed with its identity key):
 * reports its endpoints and returns the network map to configure WireGuard.
 */
export const sync = factory.createHandlers(
  requireDevice,
  validate("json", syncDeviceBody),
  async (c) => {
    const map = await c.var.services.devices.sync(c.var.device.id, c.req.valid("json"));
    return c.json(map, 200);
  },
);

/** `mesh logout`: the device removes itself (signed with its identity key). */
export const deleteSelf = factory.createHandlers(requireDevice, async (c) => {
  await c.var.services.devices.deleteSelf(c.var.device.id);
  return c.body(null, 204);
});
