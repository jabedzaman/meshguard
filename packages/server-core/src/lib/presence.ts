import type { Redis } from "ioredis";

/** A device is online if it synced within this window (agents sync every 10s). */
export const ONLINE_WINDOW_MS = 30_000;

/**
 * How often a syncing device's lastSeenAt is copied to Postgres. Postgres only
 * answers "last seen" for offline devices, so it may lag by this much.
 */
export const PERSIST_INTERVAL_MS = 5 * 60_000;

const SEEN_KEY_PREFIX = "presence:device:";

// The network id is in the key so an expired key alone says which network's
// listeners to tell (see the presence expiry listener in workers).
const seenKey = (networkId: string, deviceId: string) =>
  `${SEEN_KEY_PREFIX}${networkId}:${deviceId}`;
const persistKey = (deviceId: string) => `presence:persisted:${deviceId}`;

/** The device a presence key belongs to, or null for any other key. */
export function parsePresenceKey(key: string) {
  if (!key.startsWith(SEEN_KEY_PREFIX)) return null;
  const [networkId, deviceId] = key.slice(SEEN_KEY_PREFIX.length).split(":");
  return networkId && deviceId ? { networkId, deviceId } : null;
}

/**
 * Device presence in Redis: each sync refreshes a key that expires after the
 * online window, so "online" is just "the key exists" and a sync costs no
 * Postgres write.
 */
export class PresenceStore {
  constructor(private readonly redis: Redis) {}

  /**
   * Marks the device as seen. `connected` is true when it was offline before
   * this sync; `persist` when lastSeenAt is due to be written to Postgres
   * (first sync, or PERSIST_INTERVAL_MS since the last write).
   */
  async touch(networkId: string, deviceId: string, at = new Date()) {
    const results = await this.redis
      .multi()
      .set(seenKey(networkId, deviceId), at.getTime(), "PX", ONLINE_WINDOW_MS, "GET")
      .set(persistKey(deviceId), 1, "PX", PERSIST_INTERVAL_MS, "NX")
      .exec();
    if (!results) throw new Error("presence transaction aborted");
    for (const [err] of results) if (err) throw err;
    return { connected: results[0]![1] === null, persist: results[1]![1] === "OK" };
  }

  /** When each online device in the network last synced; offline devices are absent. */
  async lastSeen(networkId: string, deviceIds: string[]): Promise<Map<string, Date>> {
    const seen = new Map<string, Date>();
    if (deviceIds.length === 0) return seen;
    const values = await this.redis.mget(deviceIds.map((id) => seenKey(networkId, id)));
    deviceIds.forEach((id, i) => {
      const value = values[i];
      if (value) seen.set(id, new Date(Number(value)));
    });
    return seen;
  }

  async clear(networkId: string, deviceId: string) {
    await this.redis.del(seenKey(networkId, deviceId), persistKey(deviceId));
  }
}
