import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { DeviceNonces } from "~/lib/device-nonces";

// Runs against a real Redis (the dev one by default) and only touches keys for
// a random device id, so it never disturbs dev data.
const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15", {
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
const reachable = await redis.connect().then(
  () => true,
  () => false,
);
const nonces = new DeviceNonces(redis);
const deviceId = randomUUID();

describe.runIf(reachable)("device nonces", () => {
  afterAll(async () => {
    const keys = await redis.keys(`device-nonce:${deviceId}:*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
  });

  it("accepts a nonce once per device", async () => {
    expect(await nonces.claim(deviceId, "AAECAwQFBgcICQoLDA0ODw")).toBe(true);
    expect(await nonces.claim(deviceId, "AAECAwQFBgcICQoLDA0ODw")).toBe(false);
    expect(await nonces.claim(deviceId, "BAECAwQFBgcICQoLDA0ODw")).toBe(true);
  });

  it("expires nonces after the signature window", async () => {
    await nonces.claim(deviceId, "CAECAwQFBgcICQoLDA0ODw");
    const ttl = await redis.pttl(`device-nonce:${deviceId}:CAECAwQFBgcICQoLDA0ODw`);
    expect(ttl).toBeGreaterThan(3 * 60_000);
    expect(ttl).toBeLessThanOrEqual(4 * 60_000);
  });
});
