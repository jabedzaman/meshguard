import type { Redis } from "ioredis";

/** A device is online if it synced within this window (agents sync every 10s). */
export const ONLINE_WINDOW_MS = 30_000;

/**
 * How often a syncing device's lastSeenAt is copied to Postgres. Postgres only
 * answers "last seen" for offline devices, so it may lag by this much.
 */
export const PERSIST_INTERVAL_MS = 5 * 60_000;

const seenKey = (deviceId: string) => `presence:device:${deviceId}`;
const persistKey = (deviceId: string) => `presence:persisted:${deviceId}`;

/**
 * Device presence in Redis: each sync refreshes a key that expires after the
 * online window, so "online" is just "the key exists" and a sync costs no
 * Postgres write.
 */
export class PresenceStore {
  constructor(private readonly redis: Redis) {}

  /**
   * Marks the device as seen. Returns true when lastSeenAt is due to be
   * written to Postgres (first sync, or PERSIST_INTERVAL_MS since the last
   * write).
   */
  async touch(deviceId: string, at = new Date()): Promise<boolean> {
    const results = await this.redis
      .multi()
      .set(seenKey(deviceId), at.getTime(), "PX", ONLINE_WINDOW_MS)
      .set(persistKey(deviceId), 1, "PX", PERSIST_INTERVAL_MS, "NX")
      .exec();
    if (!results) throw new Error("presence transaction aborted");
    for (const [err] of results) if (err) throw err;
    return results[1]![1] === "OK";
  }

  /** When each online device last synced; offline devices are absent. */
  async lastSeen(deviceIds: string[]): Promise<Map<string, Date>> {
    const seen = new Map<string, Date>();
    if (deviceIds.length === 0) return seen;
    const values = await this.redis.mget(deviceIds.map(seenKey));
    deviceIds.forEach((id, i) => {
      const value = values[i];
      if (value) seen.set(id, new Date(Number(value)));
    });
    return seen;
  }

  async clear(deviceId: string) {
    await this.redis.del(seenKey(deviceId), persistKey(deviceId));
  }
}
