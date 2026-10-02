import type { Redis } from "ioredis";
import { type DeviceEvents, parsePresenceKey } from "@mesh/server-core";
import { logger } from "~/lib/logger";

const log = logger.child({ listener: "presence-expiry" });

/**
 * Publishes `disconnected` when a device's presence key expires, i.e. it
 * stopped syncing. Relies on Redis keyspace notifications for expired keys.
 */
export async function startPresenceExpiryListener(redis: Redis, deviceEvents: DeviceEvents) {
  await enableExpiredNotifications(redis);

  const subscriber = redis.duplicate();
  subscriber.on("message", (_channel, key: string) => {
    const device = parsePresenceKey(key);
    if (device) deviceEvents.publish({ type: "disconnected", ...device });
  });
  await subscriber.subscribe(`__keyevent@${redis.options.db ?? 0}__:expired`);
  log.info("listening for presence expiry");

  return { close: () => subscriber.quit() };
}

/** Adds the `Ex` flags (keyevent, expired) to Redis's notify-keyspace-events. */
async function enableExpiredNotifications(redis: Redis) {
  try {
    const [, flags = ""] = (await redis.config("GET", "notify-keyspace-events")) as string[];
    const hasExpired = flags.includes("x") || flags.includes("A");
    if (flags.includes("E") && hasExpired) return;
    const merged = [...new Set(`${flags}Ex`)].join("");
    await redis.config("SET", "notify-keyspace-events", merged);
  } catch (err) {
    // Managed Redis may forbid CONFIG; then it must be set there.
    log.warn({ err }, "could not enable expired-key notifications; set notify-keyspace-events Ex");
  }
}
