import { aliasedTable, and, eq, inArray, isNull, or, schema, type Db } from "@meshguard/db";
import { NotFoundError, ValidationError } from "~/errors";

const { aclRules, devices, networks } = schema;

export const ACL_PROTOCOLS = aclRules.protocol.enumValues;
export type AclProtocol = (typeof ACL_PROTOCOLS)[number];
export type AclDefaultAction = (typeof networks.aclDefaultAction.enumValues)[number];

export interface CreateAclRuleInput {
  /** Null: any device in the network. */
  sourceDeviceId: string | null;
  /** Null: every device in the network. */
  destinationDeviceId: string | null;
  protocol: AclProtocol;
  /** TCP/UDP only; omit for every port. */
  portFrom?: number;
  portTo?: number;
}

/**
 * Access rules: who may reach whom inside a network. With the default action
 * "allow" every device reaches every other; with "deny" only rules let
 * traffic in. Enforced by each destination's agent, which gets its inbound
 * rules on sync (see policyFor).
 */
export class AclService {
  constructor(private readonly db: Db) {}

  async get(organizationId: string, networkId: string) {
    const network = await this.networkInOrganization(organizationId, networkId);
    const source = aliasedTable(devices, "source");
    const destination = aliasedTable(devices, "destination");
    const rows = await this.db
      .select({
        id: aclRules.id,
        protocol: aclRules.protocol,
        portFrom: aclRules.portFrom,
        portTo: aclRules.portTo,
        createdAt: aclRules.createdAt,
        sourceId: source.id,
        sourceName: source.name,
        destinationId: destination.id,
        destinationName: destination.name,
      })
      .from(aclRules)
      .leftJoin(source, eq(aclRules.sourceDeviceId, source.id))
      .leftJoin(destination, eq(aclRules.destinationDeviceId, destination.id))
      .where(eq(aclRules.networkId, networkId))
      .orderBy(aclRules.createdAt);
    return {
      defaultAction: network.aclDefaultAction,
      rules: rows.map(({ sourceId, sourceName, destinationId, destinationName, ...rule }) => ({
        ...rule,
        source: sourceId ? { id: sourceId, name: sourceName! } : null,
        destination: destinationId ? { id: destinationId, name: destinationName! } : null,
      })),
    };
  }

  async setDefaultAction(organizationId: string, networkId: string, action: AclDefaultAction) {
    await this.networkInOrganization(organizationId, networkId);
    await this.db
      .update(networks)
      .set({ aclDefaultAction: action })
      .where(eq(networks.id, networkId));
    return { defaultAction: action };
  }

  async createRule(organizationId: string, networkId: string, input: CreateAclRuleInput) {
    await this.networkInOrganization(organizationId, networkId);
    const named = [input.sourceDeviceId, input.destinationDeviceId].filter(
      (id): id is string => id !== null,
    );
    if (named.length > 0) {
      const found = await this.db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.networkId, networkId), inArray(devices.id, named)));
      if (found.length !== new Set(named).size) throw new NotFoundError("device");
    }
    if (input.sourceDeviceId !== null && input.sourceDeviceId === input.destinationDeviceId) {
      throw new ValidationError(
        [{ path: "destinationDeviceId", message: "A device always reaches itself" }],
        "A device always reaches itself",
      );
    }
    const [rule] = await this.db
      .insert(aclRules)
      .values({
        networkId,
        sourceDeviceId: input.sourceDeviceId,
        destinationDeviceId: input.destinationDeviceId,
        protocol: input.protocol,
        portFrom: input.portFrom ?? null,
        portTo: input.portFrom === undefined ? null : (input.portTo ?? input.portFrom),
      })
      .returning({ id: aclRules.id });
    return rule!;
  }

  async removeRule(organizationId: string, ruleId: string) {
    const [deleted] = await this.db
      .delete(aclRules)
      .where(
        and(
          eq(aclRules.id, ruleId),
          inArray(
            aclRules.networkId,
            this.db
              .select({ id: networks.id })
              .from(networks)
              .where(eq(networks.organizationId, organizationId)),
          ),
        ),
      )
      .returning({ id: aclRules.id });
    if (!deleted) throw new NotFoundError("acl_rule");
  }

  /**
   * What may reach a device, for its agent: the network's default action and,
   * when that is "deny", the rules naming it (or every device) as destination,
   * with sources resolved to mesh addresses (null: any peer).
   */
  async policyFor(networkId: string, deviceId: string) {
    const [network] = await this.db
      .select({ defaultAction: networks.aclDefaultAction })
      .from(networks)
      .where(eq(networks.id, networkId));
    if (!network || network.defaultAction === "allow") {
      return { defaultAction: "allow" as const, inbound: [] };
    }
    const rows = await this.db
      .select({
        sourceDeviceId: aclRules.sourceDeviceId,
        protocol: aclRules.protocol,
        portFrom: aclRules.portFrom,
        portTo: aclRules.portTo,
        sourceIpv4: devices.meshIpv4,
        sourceIpv6: devices.meshIpv6,
      })
      .from(aclRules)
      .leftJoin(devices, eq(aclRules.sourceDeviceId, devices.id))
      .where(
        and(
          eq(aclRules.networkId, networkId),
          or(isNull(aclRules.destinationDeviceId), eq(aclRules.destinationDeviceId, deviceId)),
        ),
      )
      .orderBy(aclRules.createdAt);
    return {
      defaultAction: "deny" as const,
      inbound: rows.map((row) => ({
        sources:
          row.sourceDeviceId === null
            ? null
            : [row.sourceIpv4, row.sourceIpv6].filter((ip): ip is string => ip !== null),
        protocol: row.protocol,
        portFrom: row.portFrom,
        portTo: row.portTo,
      })),
    };
  }

  private async networkInOrganization(organizationId: string, networkId: string) {
    const [network] = await this.db
      .select({ id: networks.id, aclDefaultAction: networks.aclDefaultAction })
      .from(networks)
      .where(and(eq(networks.id, networkId), eq(networks.organizationId, organizationId)));
    if (!network) throw new NotFoundError("network");
    return network;
  }
}
