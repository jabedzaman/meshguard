import { and, eq, schema, type Db } from "@meshguard/db";
import { AppError, ConflictError, NotFoundError } from "~/errors";
import { isUniqueViolation } from "~/lib/db-errors";
import { networkDnsDomain, randomNetworkLabel } from "~/lib/dns-name";
import { DEFAULT_IPV4_CIDR, randomUlaPrefix } from "~/lib/ip";

const { networks } = schema;

/** Label picks before giving up; there are about 400,000 two-word labels. */
const MAX_LABEL_ATTEMPTS = 10;

export interface CreateNetworkInput {
  name: string;
  /** Validated with ipv4CidrSchema. Defaults to DEFAULT_IPV4_CIDR. */
  ipv4Cidr?: string;
}

type NetworkRow = typeof networks.$inferSelect;

export class NetworksService {
  constructor(
    private readonly db: Db,
    /** DNS_BASE_DOMAIN: devices resolve as `<device>.<dns label>.<baseDomain>`. */
    private readonly dnsBaseDomain: string,
  ) {}

  async list(organizationId: string) {
    const rows = await this.db
      .select()
      .from(networks)
      .where(eq(networks.organizationId, organizationId));
    return rows.map((row) => this.withDnsDomain(row));
  }

  async get(organizationId: string, id: string) {
    const [network] = await this.db
      .select()
      .from(networks)
      .where(and(eq(networks.id, id), eq(networks.organizationId, organizationId)));
    if (!network) throw new NotFoundError("network");
    return this.withDnsDomain(network);
  }

  async create(organizationId: string, input: CreateNetworkInput) {
    for (let attempt = 0; attempt < MAX_LABEL_ATTEMPTS; attempt++) {
      try {
        const [network] = await this.db
          .insert(networks)
          .values({
            organizationId,
            name: input.name,
            ipv4Cidr: input.ipv4Cidr ?? DEFAULT_IPV4_CIDR,
            ipv6Cidr: randomUlaPrefix(),
            dnsLabel: randomNetworkLabel(),
          })
          .returning();
        return this.withDnsDomain(network!);
      } catch (error) {
        if (isUniqueViolation(error, "networks_organization_id_name_unique")) {
          throw new ConflictError("network_name_taken", "A network with this name already exists");
        }
        if (isUniqueViolation(error, "networks_dns_label_unique")) continue;
        throw error;
      }
    }
    throw new AppError(
      503,
      "dns_label_exhausted",
      "Could not pick a DNS name for the network; try again",
    );
  }

  /** The domain the network's devices resolve under, e.g. `brave-otter.lvh.me`. */
  dnsDomain(label: string): string {
    return networkDnsDomain(label, this.dnsBaseDomain);
  }

  private withDnsDomain(row: NetworkRow) {
    return { ...row, dnsDomain: this.dnsDomain(row.dnsLabel) };
  }
}
