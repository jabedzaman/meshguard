import type { Db } from "@mesh/db";
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

export function createServices(db: Db, options: ServicesOptions = {}) {
  return {
    networks: new NetworksService(db),
    enrollmentTokens: new EnrollmentTokensService(db),
    devices: new DevicesService(db, {
      relayUrl: options.relayUrl,
      stunServers: options.stunServers,
    }),
  };
}

export type Services = ReturnType<typeof createServices>;
