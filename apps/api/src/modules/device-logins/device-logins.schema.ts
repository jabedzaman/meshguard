import { z } from "zod";
import { DEVICE_LOGIN_ID_PATTERN, DEVICE_LOGIN_SECRET_PREFIX } from "@meshguard/server-core";

export const startDeviceLoginBody = z.object({
  hostname: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/, "Invalid hostname"),
  platform: z.enum(["darwin", "linux", "windows"]),
});

export const pollDeviceLoginBody = z.object({
  secret: z.string().startsWith(DEVICE_LOGIN_SECRET_PREFIX, "Not a device login secret"),
});

export const deviceLoginIdParams = z.object({
  id: z.string().regex(DEVICE_LOGIN_ID_PATTERN, "Invalid login"),
});

export const approveDeviceLoginBody = z.object({
  networkId: z.uuid(),
});
