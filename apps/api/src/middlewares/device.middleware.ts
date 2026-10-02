import { createMiddleware } from "hono/factory";
import { AppError, DEVICE_HEADERS, verifyDeviceSignature } from "@meshguard/server-core";
import type { AppEnv } from "~/types";

export interface AuthenticatedDevice {
  id: string;
  networkId: string;
}

function rejected(message: string) {
  return new AppError(401, "invalid_device_signature", message);
}

/**
 * Authenticates an agent request signed with the device's identity key (see
 * @meshguard/server-core device-auth). Exposes the device as c.var.device.
 */
export const requireDevice = createMiddleware<
  AppEnv & { Variables: { device: AuthenticatedDevice } }
>(async (c, next) => {
  const deviceId = c.req.header(DEVICE_HEADERS.device);
  const timestamp = c.req.header(DEVICE_HEADERS.timestamp);
  const signature = c.req.header(DEVICE_HEADERS.signature);
  if (!deviceId || !timestamp || !signature) throw rejected("Device signature required");

  const device = /^[0-9a-f-]{36}$/i.test(deviceId)
    ? await c.var.services.devices.findForAuth(deviceId)
    : null;
  // Same error for unknown devices and bad signatures: don't reveal which ids exist.
  if (!device) throw rejected("Invalid device signature");

  // Hono caches the body, so validators can still read it afterwards.
  const body = await c.req.text();
  const valid = verifyDeviceSignature({
    publicKey: device.identityPublicKey,
    signature,
    method: c.req.method,
    path: c.req.path,
    timestamp,
    body,
  });
  if (!valid) throw rejected("Invalid device signature");

  c.set("device", { id: device.id, networkId: device.networkId });
  await next();
});
