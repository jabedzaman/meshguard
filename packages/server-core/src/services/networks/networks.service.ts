import { and, eq, schema, type Db } from "@mesh/db";
import { ConflictError, NotFoundError } from "~/errors";
import { isUniqueViolation } from "~/lib/db-errors";
import { DEFAULT_IPV4_CIDR, randomUlaPrefix } from "~/lib/ip";

const { networks } = schema;

export interface CreateNetworkInput {
  name: string;
  /** Validated with ipv4CidrSchema. Defaults to DEFAULT_IPV4_CIDR. */
  ipv4Cidr?: string;
}

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

  async create(organizationId: string, input: CreateNetworkInput) {
    try {
      const [network] = await this.db
        .insert(networks)
        .values({
          organizationId,
          name: input.name,
          ipv4Cidr: input.ipv4Cidr ?? DEFAULT_IPV4_CIDR,
          ipv6Cidr: randomUlaPrefix(),
        })
        .returning();
      return network!;
    } catch (error) {
      if (isUniqueViolation(error, "networks_organization_id_name_unique")) {
        throw new ConflictError("network_name_taken", "A network with this name already exists");
      }
      throw error;
    }
  }
}
