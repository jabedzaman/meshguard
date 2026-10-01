import { and, eq, schema, type Db } from "@mesh/db";
import { NotFoundError } from "~/errors";

const { networks } = schema;

export class NetworksService {
  constructor(private readonly db: Db) {}

  async list(organizationId: string) {
    return await this.db.select().from(networks).where(eq(networks.organizationId, organizationId));
  }

  async get(organizationId: string, id: string) {
    const [network] = await this.db
      .select()
      .from(networks)
      .where(and(eq(networks.id, id), eq(networks.organizationId, organizationId)));
    if (!network) throw new NotFoundError("network");
    return network;
  }
}
