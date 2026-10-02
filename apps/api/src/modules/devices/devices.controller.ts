import { streamSSE } from "hono/streaming";
import { factory } from "~/lib/factory";
import { logger } from "~/lib/logger";
import { validate } from "~/lib/validator";
import { requireOrganization, requirePermission } from "~/middlewares/auth.middleware";
import { requireDevice } from "~/middlewares/device.middleware";
import {
  enrollDeviceBody,
  renameDeviceBody,
  syncDeviceBody,
} from "~/modules/devices/devices.schema";
import { idParams, networkIdParams } from "~/schemas/params.schema";

/** Called by the agent (`meshguard up --token ...`); authenticated by the enrollment token. */
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

/** Renames a device; its DNS name changes with it. */
export const rename = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["update"] }),
  validate("param", idParams),
  validate("json", renameDeviceBody),
  async (c) => {
    const device = await c.var.services.devices.rename(
      c.var.organizationId,
      c.req.valid("param").id,
      c.req.valid("json").name,
    );
    return c.json(device, 200);
  },
);

/** Removes a device from its network; its agent is refused from then on. */
export const remove = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["delete"] }),
  validate("param", idParams),
  async (c) => {
    await c.var.services.devices.remove(c.var.organizationId, c.req.valid("param").id);
    return c.body(null, 204);
  },
);

/** Keeps idle event streams from being closed by proxies. */
const HEARTBEAT_MS = 25_000;

/**
 * Server-sent events for the network's devices (enrolled, connected, updated,
 * disconnected, removed). The web re-reads the device list on each one, and
 * after `ready` so nothing missed while (re)connecting is lost.
 */
export const events = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["read"] }),
  validate("param", networkIdParams),
  async (c) => {
    const events = await c.var.services.devices.subscribe(
      c.var.organizationId,
      c.req.valid("param").networkId,
    );
    return streamSSE(
      c,
      async (stream) => {
        stream.onAbort(() => events.close());
        const heartbeat = setInterval(() => void stream.write(": heartbeat\n\n"), HEARTBEAT_MS);
        try {
          await stream.writeSSE({ event: "ready", data: "" });
          for await (const event of events) {
            await stream.writeSSE({ event: "device", data: JSON.stringify(event) });
          }
        } finally {
          clearInterval(heartbeat);
          events.close();
        }
      },
      async (err) => {
        logger.warn({ err }, "device event stream failed");
      },
    );
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

/** `meshguard logout`: the device removes itself (signed with its identity key). */
export const deleteSelf = factory.createHandlers(requireDevice, async (c) => {
  await c.var.services.devices.deleteSelf(c.var.device.id);
  return c.body(null, 204);
});
