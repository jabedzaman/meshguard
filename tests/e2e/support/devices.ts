import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";
import { E2E } from "./env";

// Talk to the API as an agent does: enroll with a token, then sign syncs.

/** Raw 32-byte public keys, base64, as the agent sends them. */
export function deviceKeys() {
  const raw = (type: "ed25519" | "x25519") =>
    generateKeyPairSync(type as "ed25519")
      .publicKey.export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("base64");
  return { identityPublicKey: raw("ed25519"), wireguardPublicKey: raw("x25519") };
}

/** A device with its private identity key, for signing sync requests like the agent. */
export function signingDevice() {
  const identity = generateKeyPairSync("ed25519");
  const raw = (key: KeyObject) =>
    key.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  return {
    privateKey: identity.privateKey,
    keys: {
      identityPublicKey: raw(identity.publicKey),
      wireguardPublicKey: raw(generateKeyPairSync("x25519").publicKey),
    },
  };
}

/** A signed POST as the agent sends it (internal/coordination/sign.go). */
async function signedPost(
  path: string,
  device: { id: string; privateKey: KeyObject },
  body: unknown,
  {
    tamper = false,
    timestamp = Date.now(),
    // null: sign the pre-nonce way, which the API refuses.
    nonce = randomBytes(16).toString("base64url") as string | null,
  } = {},
) {
  const json = JSON.stringify(body);
  const bodyHash = createHash("sha256").update(json).digest("hex");
  const message =
    nonce === null
      ? `POST\n${path}\n${timestamp}\n${bodyHash}`
      : `POST\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const signature = sign(null, Buffer.from(message), device.privateKey).toString("base64");
  const res = await fetch(`${E2E.apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MeshGuard-Device": device.id,
      "X-MeshGuard-Timestamp": String(timestamp),
      ...(nonce !== null && { "X-MeshGuard-Nonce": nonce }),
      "X-MeshGuard-Signature": signature,
    },
    body: tamper ? JSON.stringify({ endpoints: ["6.6.6.6:51820"] }) : json,
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** Signed POST /v1/devices/self/sync with a fresh nonce. */
export function sync(
  device: { id: string; privateKey: KeyObject },
  body: unknown,
  options?: Parameters<typeof signedPost>[3],
) {
  return signedPost("/v1/devices/self/sync", device, body, options);
}

/** Signed POST /v1/devices/self/certificate with a certificate request. */
export function requestCertificate(device: { id: string; privateKey: KeyObject }, csr: string) {
  return signedPost("/v1/devices/self/certificate", device, { csr });
}

/** Signed POST /v1/devices/self/watch: resolves when the map differs from `revision` (or ~50s). */
export function watch(device: { id: string; privateKey: KeyObject }, revision: string) {
  return signedPost("/v1/devices/self/watch", device, { revision });
}

/** A made-up client address, so each call looks like a different machine to the rate limits. */
export function randomClientIp() {
  const octet = () => 1 + Math.floor(Math.random() * 253);
  return `198.51.${octet()}.${octet()}`;
}

/**
 * What `meshguard up` sends. No session: the token is the credential. Each call
 * comes from its own made-up address (`clientIp` to choose it): enrollment is
 * limited per address, and a test suite enrolls far more devices than one
 * address may in a minute.
 */
export async function enroll(body: Record<string, unknown>, clientIp = randomClientIp()) {
  const res = await fetch(`${E2E.apiUrl}/v1/devices/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": clientIp },
    body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}
