import { and, eq, inArray, schema, type Db } from "@meshguard/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "~/errors";
import type { DeviceEvents } from "~/events/device-events";
import { SERVICE_NAME_PATTERN } from "~/services/services/services.service";
import {
  MAX_CONNECTORS_PER_NETWORK,
  MAX_CONNECTOR_DOMAINS,
  parseConnectorDomain,
} from "~/lib/connector-domain";
import { isUniqueViolation } from "~/lib/db-errors";
import type { PresenceStore } from "~/lib/presence";

const { appConnectorHosts, appConnectors, devices, networks } = schema;

/**
 * App connectors: the traffic for some domains goes through the first online
 * device that hosts the connector. Owners and admins create them and choose
 * the hosts, since a host sees what its peers look up and reach.
 */
export class ConnectorsService {
  constructor(
    private readonly db: Db,
    private readonly presence: PresenceStore,
    private readonly events: DeviceEvents,
  ) {}

  async list(organizationId: string, networkId: string) {
    await this.networkInOrganization(organizationId, networkId);
    const rows = await this.db
      .select()
      .from(appConnectors)
      .where(eq(appConnectors.networkId, networkId))
      .orderBy(appConnectors.name);
    const hostRows = rows.length
      ? await this.db
          .select({
            connectorId: appConnectorHosts.connectorId,
            deviceId: devices.id,
            name: devices.name,
          })
          .from(appConnectorHosts)
          .innerJoin(devices, eq(devices.id, appConnectorHosts.deviceId))
          .where(
            inArray(
              appConnectorHosts.connectorId,
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
      domains: row.domains,
      hosts: hostRows
        .filter((host) => host.connectorId === row.id)
        .map((host) => ({ id: host.deviceId, name: host.name, online: online.has(host.deviceId) })),
    }));
  }

  async create(
    organizationId: string,
    networkId: string,
    input: { name: string; domains: string[]; hostDeviceIds: string[] },
  ) {
    await this.networkInOrganization(organizationId, networkId);
    const domains = this.parseDomains(input.domains);
    const hosts = await this.assertDevicesInNetwork(networkId, input.hostDeviceIds);
    const existing = await this.db
      .select({ id: appConnectors.id })
      .from(appConnectors)
      .where(eq(appConnectors.networkId, networkId));
    if (existing.length >= MAX_CONNECTORS_PER_NETWORK) {
      throw new AppError(
        409,
        "too_many_connectors",
        `A network can have ${MAX_CONNECTORS_PER_NETWORK} app connectors`,
      );
    }
    try {
      const connector = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(appConnectors)
          .values({ networkId, name: input.name, domains })
          .returning();
        if (hosts.length) {
          await tx
            .insert(appConnectorHosts)
            .values(hosts.map((deviceId) => ({ connectorId: row!.id, deviceId })));
        }
        return row!;
      });
      this.changed(networkId);
      return { id: connector.id, name: connector.name, domains: connector.domains };
    } catch (error) {
      if (isUniqueViolation(error, "app_connectors_network_id_name_unique")) {
        throw new ConflictError("connector_name_taken", `A connector named ${input.name} exists`);
      }
      throw error;
    }
  }

  /** Replaces a connector's domains and hosts (either may be omitted). */
  async update(
    organizationId: string,
    connectorId: string,
    input: { domains?: string[]; hostDeviceIds?: string[] },
  ) {
    const connector = await this.connectorInOrganization(organizationId, connectorId);
    const domains = input.domains ? this.parseDomains(input.domains) : undefined;
    const hosts = input.hostDeviceIds
      ? await this.assertDevicesInNetwork(connector.networkId, input.hostDeviceIds)
      : undefined;
    await this.db.transaction(async (tx) => {
      if (domains) {
        await tx.update(appConnectors).set({ domains }).where(eq(appConnectors.id, connectorId));
      }
      if (hosts) {
        await tx.delete(appConnectorHosts).where(eq(appConnectorHosts.connectorId, connectorId));
        if (hosts.length) {
          await tx
            .insert(appConnectorHosts)
            .values(hosts.map((deviceId) => ({ connectorId, deviceId })));
        }
      }
    });
    this.changed(connector.networkId);
  }

  async remove(organizationId: string, connectorId: string) {
    const connector = await this.connectorInOrganization(organizationId, connectorId);
    await this.db.delete(appConnectors).where(eq(appConnectors.id, connectorId));
    this.changed(connector.networkId);
  }

  /** Wakes the network's agents' watches so they pick the change up at once. */
  private changed(networkId: string) {
    this.events.publishAclChange(networkId);
  }

  private parseDomains(texts: string[]) {
    const domains = new Set<string>();
    for (const [index, text] of texts.entries()) {
      const domain = parseConnectorDomain(text);
      if (!domain) {
        throw new ValidationError(
          [{ path: `domains.${index}`, message: `${text} isn't a domain like example.com` }],
          "Invalid domain",
        );
      }
      domains.add(domain);
    }
    if (domains.size === 0 || domains.size > MAX_CONNECTOR_DOMAINS) {
      throw new ValidationError(
        [{ path: "domains", message: `Give 1–${MAX_CONNECTOR_DOMAINS} domains` }],
        "Invalid domains",
      );
    }
    return [...domains].sort();
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
      .select({ id: networks.id })
      .from(networks)
      .where(and(eq(networks.id, networkId), eq(networks.organizationId, organizationId)));
    if (!network) throw new NotFoundError("network");
    return network;
  }

  private async connectorInOrganization(organizationId: string, connectorId: string) {
    const [connector] = await this.db
      .select({ id: appConnectors.id, networkId: appConnectors.networkId })
      .from(appConnectors)
      .innerJoin(networks, eq(networks.id, appConnectors.networkId))
      .where(and(eq(appConnectors.id, connectorId), eq(networks.organizationId, organizationId)));
    if (!connector) throw new NotFoundError("connector");
    return connector;
  }
}

/** A connector's name is a DNS-label-like name, like a service's. */
export const CONNECTOR_NAME_PATTERN = SERVICE_NAME_PATTERN;
