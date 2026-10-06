import { z } from "zod";
import { DEVICE_NAME_PATTERN, ENROLLMENT_TOKEN_PREFIX } from "@meshguard/server-core";

/** Base64 (standard) encoding of exactly 32 bytes: Ed25519 and Curve25519 public keys. */
const publicKey32 = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, "Must be a base64-encoded 32-byte public key");

export const enrollDeviceBody = z.object({
  token: z.string().startsWith(ENROLLMENT_TOKEN_PREFIX, "Not an enrollment token"),
  hostname: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/, "Invalid hostname"),
  platform: z.enum(["darwin", "linux", "windows"]),
  identityPublicKey: publicKey32,
  wireguardPublicKey: publicKey32,
});

/** "1.2.3.4:51820" or "[fd00::1]:51820". */
const endpoint = z
  .string()
  .regex(/^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-fA-F:.]+\]):\d{1,5}$/, "Must be ip:port");

export const syncDeviceBody = z.object({
  /** Where peers can reach this device's WireGuard, best first. */
  endpoints: z.array(endpoint).max(16),
});

export const renameDeviceBody = z.object({
  /** The device's DNS label (`<name>.internal`); case is folded like DNS does. */
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      DEVICE_NAME_PATTERN,
      "Use 1–63 letters, digits and hyphens, not starting or ending with a hyphen",
    ),
});

export const watchDeviceBody = z.object({
  /** The revision of the network map the agent has (from its last sync). */
  revision: z.string().min(1).max(64),
});
