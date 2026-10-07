import { and, eq, inArray, or, schema, type Db } from "@meshguard/db";
import { AppError, ConflictError, NotFoundError } from "~/errors";
import type { DeviceEvents } from "~/events/device-events";
import { TAG_PATTERN } from "~/lib/acl-policy";
import { isUniqueViolation } from "~/lib/db-errors";
import { randomFreeIpv4InCidr } from "~/lib/ip";
import type { PresenceStore } from "~/lib/presence";

const { aclRules, devices, networks, serviceHosts, services } = schema;

/** A service name is a DNS label, like a tag. */
export const SERVICE_NAME_PATTERN = TAG_PATTERN;

/** Services per network; keeps the network map small. */
export const MAX_SERVICES_PER_NETWORK = 64;

/** The addresses in a network that devices must not use: those of its services. */
export async function serviceAddresses(db: Pick<Db, "select">, networkId: string) {
  const rows = await db
    .select({ vip: services.vip })
    .from(services)
    .where(eq(services.networkId, networkId));
  return new Set(rows.map((row) => row.vip));
}

/**
 * Services: a name and a virtual address from the network's range, served by
 * devices an owner or admin picks. Clients reach the address through one
 * online host (the first by enrollment, so it only changes when that host goes
 * offline), and the host's agent rewrites it to its own.
 */
export class ServicesService {
  constructor(
    private readonly db: Db,
    private readonly presence: PresenceStore,
    private readonly events: DeviceEvents,
    /** `<name>.svc.<domain>` is how clients find a service. */
    private readonly dnsDomain: (label: string) => string,
  ) {}

  async list(organizationId: string, networkId: string) {
    const network = await this.networkInOrganization(organizationId, networkId);
    const rows = await this.db
      .select()
      .from(services)
      .where(eq(services.networkId, networkId))
      .orderBy(services.name);
    const hostRows = rows.length
      ? await this.db
          .select({
            serviceId: serviceHosts.serviceId,
            deviceId: devices.id,
            name: devices.name,
          })
          .from(serviceHosts)
          .innerJoin(devices, eq(devices.id, serviceHosts.deviceId))
          .where(
            inArray(
              serviceHosts.serviceId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(devices.createdAt)
      : [];
    const online = await this.presence.lastSeen(
      networkId,
      hostRows.map((row) => row.deviceId),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      vip: row.vip,
      dnsName: `${row.name}.svc.${this.dnsDomain(network.dnsLabel)}`,
      hosts: hostRows
        .filter((host) => host.serviceId === row.id)
        .map((host) => ({
          id: host.deviceId,
          name: host.name,
          online: online.has(host.deviceId),
        })),
    }));
  }

  async create(
    organizationId: string,
    networkId: string,
    input: { name: string; hostDeviceIds: string[] },
  ) {
    const network = await this.networkInOrganization(organizationId, networkId);
    const hosts = await this.assertDevicesInNetwork(networkId, input.hostDeviceIds);
    const existing = await this.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.networkId, networkId));
    if (existing.length >= MAX_SERVICES_PER_NETWORK) {
      throw new AppError(
        409,
        "too_many_services",
        `A network can have ${MAX_SERVICES_PER_NETWORK} services`,
      );
    }

    // Addresses are random; the unique constraints settle races.
    for (let attempt = 0; attempt < 5; attempt++) {
      const taken = await serviceAddresses(this.db, networkId);
      const deviceRows = await this.db
        .select({ ip: devices.meshIpv4 })
        .from(devices)
        .where(eq(devices.networkId, networkId));
      for (const { ip } of deviceRows) if (ip) taken.add(ip);
      const vip = randomFreeIpv4InCidr(network.ipv4Cidr, taken);
      if (!vip) throw new AppError(409, "network_full", "The network has no free address left");
      try {
        const service = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(services)
            .values({ networkId, name: input.name, vip })
            .returning();
          if (hosts.length) {
            await tx
              .insert(serviceHosts)
              .values(hosts.map((deviceId) => ({ serviceId: row!.id, deviceId })));
          }
          return row!;
        });
        this.changed(networkId);
        return { id: service.id, name: service.name, vip: service.vip };
      } catch (error) {
        if (isUniqueViolation(error, "services_network_id_name_unique")) {
          throw new ConflictError("service_name_taken", `A service named ${input.name} exists`);
        }
        if (isUniqueViolation(error, "services_network_id_vip_unique")) continue;
        throw error;
      }
    }
    throw new AppError(
      503,
      "vip_exhausted",
      "Could not pick an address for the service; try again",
    );
  }

  /** Replaces the devices serving a service. */
  async setHosts(organizationId: string, serviceId: string, hostDeviceIds: string[]) {
    const service = await this.serviceInOrganization(organizationId, serviceId);
    const hosts = await this.assertDevicesInNetwork(service.networkId, hostDeviceIds);
    await this.db.transaction(async (tx) => {
      await tx.delete(serviceHosts).where(eq(serviceHosts.serviceId, serviceId));
      if (hosts.length) {
        await tx.insert(serviceHosts).values(hosts.map((deviceId) => ({ serviceId, deviceId })));
      }
    });
    this.changed(service.networkId);
  }

  /** Deletes the service and the rules naming it. */
  async remove(organizationId: string, serviceId: string) {
    const service = await this.serviceInOrganization(organizationId, serviceId);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(aclRules)
        .where(
          and(
            eq(aclRules.networkId, service.networkId),
            or(
              eq(aclRules.sourceService, service.name),
              eq(aclRules.destinationService, service.name),
            ),
          ),
        );
      await tx.delete(services).where(eq(services.id, serviceId));
    });
    this.changed(service.networkId);
  }

  /** Wakes the network's agents and the access rules that may name services. */
  private changed(networkId: string) {
    this.events.publishAclChange(networkId);
  }

  private async assertDevicesInNetwork(networkId: string, deviceIds: string[]) {
    const unique = [...new Set(deviceIds)];
    if (unique.length === 0) return unique;
    const found = await this.db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.networkId, networkId), inArray(devices.id, unique)));
    if (found.length !== unique.length) throw new NotFoundError("device");
    return unique;
  }

  private async networkInOrganization(organizationId: string, networkId: string) {
    const [network] = await this.db
      .select({ id: networks.id, ipv4Cidr: networks.ipv4Cidr, dnsLabel: networks.dnsLabel })
      .from(networks)
      .where(and(eq(networks.id, networkId), eq(networks.organizationId, organizationId)));
    if (!network) throw new NotFoundError("network");
    return network;
  }

  private async serviceInOrganization(organizationId: string, serviceId: string) {
    const [service] = await this.db
      .select({ id: services.id, name: services.name, networkId: services.networkId })
      .from(services)
      .innerJoin(networks, eq(networks.id, services.networkId))
      .where(and(eq(services.id, serviceId), eq(networks.organizationId, organizationId)));
    if (!service) throw new NotFoundError("service");
    return service;
  }
}
