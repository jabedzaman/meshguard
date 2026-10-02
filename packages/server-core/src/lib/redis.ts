import { createLogger } from "@mesh/utils";
import { Redis } from "ioredis";

const logger = createLogger("redis");

/** Redis connection for BullMQ queues and workers. */
export function createRedis(url: string) {
  // BullMQ requires maxRetriesPerRequest: null for blocking worker connections.
  const redis = new Redis(url, { maxRetriesPerRequest: null });
  redis.on("error", (err) => logger.error({ err }, "redis error"));
  return redis;
}
