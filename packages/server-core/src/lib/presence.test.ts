import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ONLINE_WINDOW_MS, parsePresenceKey, PresenceStore } from "~/lib/presence";

// Runs against a real Redis (the dev one by default) and only touches keys for
// random device ids, so it never disturbs dev data.
const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15", {
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
const reachable = await redis.connect().then(
  () => true,
  () => false,
);
const store = new PresenceStore(redis);
const networkId = randomUUID();
const ids = [randomUUID(), randomUUID()];

describe.runIf(reachable)("presence store", () => {
  beforeAll(async () => {
    for (const id of ids) await store.clear(networkId, id);
  });
  afterAll(async () => {
    for (const id of ids) await store.clear(networkId, id);
    redis.disconnect();
  });

  it("reports only devices that synced within the online window", async () => {
    const [online, offline] = ids as [string, string];
    const at = new Date("2026-10-02T12:00:00Z");
    await store.touch(networkId, online, at);

    const seen = await store.lastSeen(networkId, [online, offline]);
    expect(seen.get(online)).toEqual(at);
    expect(seen.has(offline)).toBe(false);

    const ttl = await redis.pttl(`presence:device:${networkId}:${online}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ONLINE_WINDOW_MS);
  });

  it("reports a connect only when the device was offline", async () => {
    const [id] = ids as [string];
    await store.clear(networkId, id);
    expect((await store.touch(networkId, id)).connected).toBe(true);
    expect((await store.touch(networkId, id)).connected).toBe(false);
  });

  it("asks for a Postgres write on the first sync only, until the interval passes", async () => {
    const [id] = ids as [string];
    await store.clear(networkId, id);
    expect((await store.touch(networkId, id)).persist).toBe(true);
    expect((await store.touch(networkId, id)).persist).toBe(false);

    await redis.del(`presence:persisted:${id}`);
    expect((await store.touch(networkId, id)).persist).toBe(true);
  });

  it("forgets a device when cleared", async () => {
    const [id] = ids as [string];
    await store.touch(networkId, id);
    await store.clear(networkId, id);
    expect((await store.lastSeen(networkId, [id])).size).toBe(0);
  });

  it("parses its own keys and ignores others", () => {
    expect(parsePresenceKey(`presence:device:${networkId}:${ids[0]}`)).toEqual({
      networkId,
      deviceId: ids[0],
    });
    expect(parsePresenceKey(`presence:persisted:${ids[0]}`)).toBeNull();
    expect(parsePresenceKey("bull:email:1")).toBeNull();
  });
});
