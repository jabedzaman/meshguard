import type { Db } from "@meshguard/db";
import type { Redis } from "ioredis";
import type { DeviceEvents } from "~/events/device-events";
import { DeviceNonces } from "~/lib/device-nonces";
import { DEFAULT_DNS_BASE_DOMAIN } from "~/lib/dns-name";
import { PresenceStore } from "~/lib/presence";
import { relayTokenKey } from "~/lib/relay-token";
import { AclService } from "~/services/acl/acl.service";
import { DevicesService } from "~/services/devices/devices.service";
import { EnrollmentTokensService } from "~/services/enrollment-tokens/enrollment-tokens.service";
import { type CreateNetworkInput, NetworksService } from "~/services/networks/networks.service";

export { NetworksService, type CreateNetworkInput };
export * from "~/services/acl/acl.service";
export * from "~/services/devices/devices.service";
export * from "~/services/enrollment-tokens/enrollment-tokens.service";

export interface ServicesOptions {
  /** Relay URL handed to agents in their network map. */
  relayUrl?: string;
  /** Base64 Ed25519 seed that signs devices' relay tokens (RELAY_TOKEN_KEY). */
  relayTokenKey?: string;
  /** STUN servers ("host:port") handed to agents for hole punching. */
  stunServers?: string[];
  /** DNS_BASE_DOMAIN: devices resolve as `<device>.<network dns label>.<base>`. */
  dnsBaseDomain?: string;
}

export interface ServicesDeps {
  db: Db;
  /** Device presence and request nonces. */
  redis: Redis;
  /** Publishes device changes for live listeners (the web). */
  deviceEvents: DeviceEvents;
}

export function createServices(
  { db, redis, deviceEvents }: ServicesDeps,
  options: ServicesOptions = {},
) {
  const acl = new AclService(db, deviceEvents);
  const dnsBaseDomain = options.dnsBaseDomain ?? DEFAULT_DNS_BASE_DOMAIN;
  return {
    networks: new NetworksService(db, dnsBaseDomain),
    enrollmentTokens: new EnrollmentTokensService(db),
    acl,
    deviceNonces: new DeviceNonces(redis),
    devices: new DevicesService(db, new PresenceStore(redis), deviceEvents, acl, {
      relayUrl: options.relayUrl,
      relayTokenKey: options.relayTokenKey ? relayTokenKey(options.relayTokenKey) : undefined,
      stunServers: options.stunServers,
      dnsBaseDomain,
    }),
  };
}

export type Services = ReturnType<typeof createServices>;
