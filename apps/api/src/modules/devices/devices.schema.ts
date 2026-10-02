import { z } from "zod";
import { ENROLLMENT_TOKEN_PREFIX } from "@mesh/server-core";

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
