import type { Db } from "@mesh/db";
import { NetworksService } from "~/services/networks/networks.service";

export { NetworksService };

export function createServices(db: Db) {
  return {
    networks: new NetworksService(db),
  };
}

export type Services = ReturnType<typeof createServices>;
