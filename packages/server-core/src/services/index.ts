import type { Db } from "@meshguard/db";
import type { Redis } from "ioredis";
import type { DeviceEvents } from "~/events/device-events";
import { PresenceStore } from "~/lib/presence";
import { DevicesService } from "~/services/devices/devices.service";
import { EnrollmentTokensService } from "~/services/enrollment-tokens/enrollment-tokens.service";
import { type CreateNetworkInput, NetworksService } from "~/services/networks/networks.service";

export { NetworksService, type CreateNetworkInput };
export * from "~/services/devices/devices.service";
export * from "~/services/enrollment-tokens/enrollment-tokens.service";

export interface ServicesOptions {
  /** Relay URL handed to agents in their network map. */
  relayUrl?: string;
  /** STUN servers ("host:port") handed to agents for hole punching. */
  stunServers?: string[];
}

export interface ServicesDeps {
  db: Db;
  /** Device presence. */
  redis: Redis;
  /** Publishes device changes for live listeners (the web). */
  deviceEvents: DeviceEvents;
}

export function createServices(
  { db, redis, deviceEvents }: ServicesDeps,
  options: ServicesOptions = {},
) {
  return {
    networks: new NetworksService(db),
    enrollmentTokens: new EnrollmentTokensService(db),
    devices: new DevicesService(db, new PresenceStore(redis), deviceEvents, {
      relayUrl: options.relayUrl,
      stunServers: options.stunServers,
    }),
  };
}

export type Services = ReturnType<typeof createServices>;
