import type { Redis } from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until a blocked caller can try again (0 when allowed). */
  retryAfter: number;
}

const rateKey = (name: string, key: string, window: number) => `rate:${name}:${key}:${window}`;

/**
 * Sliding window counter in Redis: the previous fixed window counts in
 * proportion to how much of it still overlaps the sliding window. Cheap
 * (two keys per caller) and shared by every API replica.
 */
export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  /** Counts one hit for `key` under the limit `name`; allowed while under `limit` hits per `windowMs`. */
  async hit(
    name: string,
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitResult> {
    const window = Math.floor(now / windowMs);
    const current = rateKey(name, key, window);
    const [[, count]] = (await this.redis
      .multi()
      .incr(current)
      .pexpire(current, windowMs * 2)
      .exec()) as [[Error | null, number], unknown];
    const previous = Number(await this.redis.get(rateKey(name, key, window - 1))) || 0;
    const elapsed = (now % windowMs) / windowMs;
    if (previous * (1 - elapsed) + count <= limit) return { allowed: true, retryAfter: 0 };
    // Blocked until the window turns over at the latest.
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000)),
    };
  }
}
