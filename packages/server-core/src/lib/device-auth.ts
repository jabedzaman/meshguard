import { createHash, createPublicKey, verify } from "node:crypto";

/**
 * Device request signing. The agent signs every control plane request with its
 * Ed25519 identity key; the API verifies it against the key stored at
 * enrollment. Keep in sync with internal/coordination/sign.go.
 *
 * Headers:
 *   X-Mesh-Device:    device id
 *   X-Mesh-Timestamp: unix milliseconds
 *   X-Mesh-Signature: base64 Ed25519 signature of signingString(...)
 */
export const DEVICE_HEADERS = {
  device: "x-mesh-device",
  timestamp: "x-mesh-timestamp",
  signature: "x-mesh-signature",
} as const;

/** Requests outside this window are rejected, limiting replay of captured requests. */
export const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

export function signingString(method: string, path: string, timestamp: string, body: string) {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

// DER prefix that turns a raw 32-byte Ed25519 public key into SPKI.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyDeviceSignature(input: {
  publicKey: string;
  signature: string;
  method: string;
  path: string;
  timestamp: string;
  body: string;
  now?: number;
}): boolean {
  const ts = Number(input.timestamp);
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > MAX_CLOCK_SKEW_MS) return false;

  const raw = Buffer.from(input.publicKey, "base64");
  const signature = Buffer.from(input.signature, "base64");
  if (raw.length !== 32 || signature.length !== 64) return false;

  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
  const message = signingString(input.method, input.path, input.timestamp, input.body);
  return verify(null, Buffer.from(message), key, signature);
}
