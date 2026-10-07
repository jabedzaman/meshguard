import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { RateLimiter } from "~/lib/rate-limiter";

const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15", {
  maxRetriesPerRequest: 1,
});
const limiter = new RateLimiter(redis);

afterAll(() => redis.quit());

describe("RateLimiter", () => {
  it("allows up to the limit, then blocks with a retry time", async () => {
    const key = randomUUID();
    const now = 1_000_000_000_000;
    for (let i = 0; i < 3; i++)
      expect((await limiter.hit("t", key, 3, 60_000, now)).allowed).toBe(true);
    const blocked = await limiter.hit("t", key, 3, 60_000, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("keeps callers apart", async () => {
    const now = 1_000_000_000_000;
    const a = randomUUID();
    await limiter.hit("t", a, 1, 60_000, now);
    expect((await limiter.hit("t", a, 1, 60_000, now)).allowed).toBe(false);
    expect((await limiter.hit("t", randomUUID(), 1, 60_000, now)).allowed).toBe(true);
  });

  it("lets the previous window fade out", async () => {
    const key = randomUUID();
    const start = 1_000_000_020_000 - (1_000_000_020_000 % 60_000);
    for (let i = 0; i < 3; i++) await limiter.hit("t", key, 3, 60_000, start);
    // Just into the next window the old hits still count nearly in full...
    expect((await limiter.hit("t", key, 3, 60_000, start + 60_000 + 1_000)).allowed).toBe(false);
    // ...and are gone one full window later.
    expect((await limiter.hit("t", key, 3, 60_000, start + 3 * 60_000)).allowed).toBe(true);
  });
});
