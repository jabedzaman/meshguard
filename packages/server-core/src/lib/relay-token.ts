import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/**
 * Relay tokens: the control plane's permission for a device to use the relay.
 * Signed with RELAY_TOKEN_KEY; the relay checks them with the matching public
 * key (RELAY_TRUST_KEY). Keep in sync with internal/relay/token.go.
 *
 * Token: base64url(key (32) || expiry unix seconds, big endian (8) || signature (64)),
 * signed over "meshguard-relay-token:" || key || expiry.
 */
const TOKEN_CONTEXT = Buffer.from("meshguard-relay-token:");

/**
 * Tokens are valid for one to two periods. The expiry is rounded to a period
 * boundary, so a device gets the same token on every sync within a period and
 * the agent only sends the relay a new one when it changes.
 */
export const RELAY_TOKEN_PERIOD_MS = 30 * 60 * 1000;

// DER prefix that turns a raw 32-byte Ed25519 seed into PKCS#8.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** The signing key from a base64 Ed25519 seed (`meshguard-relay -gen-key`). */
export function relayTokenKey(seed: string): KeyObject {
  const raw = Buffer.from(seed, "base64");
  if (raw.length !== 32) throw new Error("RELAY_TOKEN_KEY must be a base64 32-byte Ed25519 seed");
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  });
}

/** A token for a device's base64 WireGuard public key, expiring at `expiresAt`. */
export function signRelayToken(key: KeyObject, wireguardPublicKey: string, expiresAt: Date) {
  const body = Buffer.alloc(40);
  Buffer.from(wireguardPublicKey, "base64").copy(body, 0, 0, 32);
  body.writeBigUInt64BE(BigInt(Math.floor(expiresAt.getTime() / 1000)), 32);
  const signature = sign(null, Buffer.concat([TOKEN_CONTEXT, body]), key);
  return Buffer.concat([body, signature]).toString("base64url");
}

/** The expiry for a token issued at `now`: the end of the next period. */
export function relayTokenExpiry(now = new Date()) {
  const period = Math.floor(now.getTime() / RELAY_TOKEN_PERIOD_MS);
  return new Date((period + 2) * RELAY_TOKEN_PERIOD_MS);
}
