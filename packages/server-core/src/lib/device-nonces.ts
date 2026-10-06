import type { Redis } from "ioredis";
import { MAX_CLOCK_SKEW_MS } from "~/lib/device-auth";

// A signed request is valid while its timestamp is within the skew of now,
// which spans twice the skew; its nonce must be remembered at least that long.
const NONCE_TTL_MS = 2 * MAX_CLOCK_SKEW_MS;

const nonceKey = (deviceId: string, nonce: string) => `device-nonce:${deviceId}:${nonce}`;

/** Nonces of signed device requests seen recently, so a captured request can't be replayed. */
export class DeviceNonces {
  constructor(private readonly redis: Redis) {}

  /** Records the nonce; false if this device already used it. */
  async claim(deviceId: string, nonce: string) {
    const set = await this.redis.set(nonceKey(deviceId, nonce), "1", "PX", NONCE_TTL_MS, "NX");
    return set === "OK";
  }
}
