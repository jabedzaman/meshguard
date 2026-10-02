import type { Db } from "@mesh/db";
import { EnrollmentTokensService } from "~/services/enrollment-tokens/enrollment-tokens.service";
import { type CreateNetworkInput, NetworksService } from "~/services/networks/networks.service";

export { NetworksService, type CreateNetworkInput };
export * from "~/services/enrollment-tokens/enrollment-tokens.service";

export function createServices(db: Db) {
  return {
    networks: new NetworksService(db),
    enrollmentTokens: new EnrollmentTokensService(db),
  };
}

export type Services = ReturnType<typeof createServices>;
