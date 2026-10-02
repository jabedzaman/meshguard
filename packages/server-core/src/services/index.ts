import type { Db } from "@mesh/db";
import { type CreateNetworkInput, NetworksService } from "~/services/networks/networks.service";

export { NetworksService, type CreateNetworkInput };

export function createServices(db: Db) {
  return {
    networks: new NetworksService(db),
  };
}

export type Services = ReturnType<typeof createServices>;
