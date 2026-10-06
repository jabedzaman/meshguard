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

/** Signed POST /v1/devices/self/sync with a fresh nonce, as internal/coordination/sign.go does it. */
export async function sync(
  device: { id: string; privateKey: KeyObject },
  body: unknown,
  {
    tamper = false,
    timestamp = Date.now(),
    // null: sign the pre-nonce way, which the API refuses.
    nonce = randomBytes(16).toString("base64url") as string | null,
  } = {},
) {
  const path = "/v1/devices/self/sync";
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

/** What `meshguard up` sends. No session: the token is the credential. */
export async function enroll(body: Record<string, unknown>) {
  const res = await fetch(`${E2E.apiUrl}/v1/devices/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
