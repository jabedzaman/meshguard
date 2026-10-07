import { and, eq, inArray, schema, type Db } from "@meshguard/db";
import { NotFoundError, ValidationError } from "~/errors";
import type { DeviceEvents } from "~/events/device-events";
import {
  check,
  formatSelector,
  inboundRules,
  parseSelector,
  relatedPeers,
  type PolicyDevice,
  type PolicyRule,
  type Selector,
} from "~/lib/acl-policy";

const { aclRules, devices, member, networks, serviceHosts, services, user } = schema;

export const ACL_PROTOCOLS = aclRules.protocol.enumValues;
export type AclProtocol = (typeof ACL_PROTOCOLS)[number];
export type AclDefaultAction = (typeof networks.aclDefaultAction.enumValues)[number];

export interface CreateAclRuleInput {
  /** Selector text (see formatSelector): `*`, `device:<id>`, `tag:<name>`, `user:<id>`, `role:<role>`, `service:<name>`. */
  source: string;
  destination: string;
  protocol: AclProtocol;
  /** TCP/UDP only; omit for every port. */
  portFrom?: number;
  portTo?: number;
}

export interface CheckAccessInput {
  sourceDeviceId: string;
  destinationDeviceId: string;
  protocol: "tcp" | "udp" | "icmp";
  /** TCP/UDP destination port. */
  port?: number;
}

type RuleRow = typeof aclRules.$inferSelect;

/** Which column holds each kind of selector, per side. */
function selectorColumns(side: "source" | "destination", selector: Selector) {
  const cols = {
    [`${side}DeviceId`]: selector.kind === "device" ? selector.id : null,
    [`${side}Tag`]: selector.kind === "tag" ? selector.tag : null,
    [`${side}UserId`]: selector.kind === "user" ? selector.id : null,
    [`${side}Role`]: selector.kind === "role" ? selector.role : null,
    [`${side}Service`]: selector.kind === "service" ? selector.name : null,
  };
  return cols as Partial<RuleRow>;
}

function selectorOf(row: RuleRow, side: "source" | "destination"): Selector {
  const deviceId = side === "source" ? row.sourceDeviceId : row.destinationDeviceId;
  const tag = side === "source" ? row.sourceTag : row.destinationTag;
  const userId = side === "source" ? row.sourceUserId : row.destinationUserId;
  const role = side === "source" ? row.sourceRole : row.destinationRole;
  const service = side === "source" ? row.sourceService : row.destinationService;
  if (deviceId) return { kind: "device", id: deviceId };
  if (tag) return { kind: "tag", tag };
  if (userId) return { kind: "user", id: userId };
  if (role) return { kind: "role", role };
  if (service) return { kind: "service", name: service };
  return { kind: "any" };
}

/**
 * Access rules: who may reach whom inside a network. With the default action
 * "allow" every device reaches every other; with "deny" only rules let
 * traffic in. A rule's source and destination name a device, a tag, a user's
 * devices or a role's devices (see lib/acl-policy). Enforced by each
 * destination's agent, which gets its inbound rules resolved to addresses on
 * sync (see policyFor).
 */
export class AclService {
  constructor(
    private readonly db: Db,
    /** Wakes agents' watches when rules change, so they apply them at once. */
    private readonly events: DeviceEvents,
  ) {}

  /** The default action and rules, each side with a label for display. */
  async get(organizationId: string, networkId: string) {
    const network = await this.networkInOrganization(organizationId, networkId);
    const { rows, names, users } = await this.load(networkId);
    const describe = (selector: Selector) => ({
      selector: formatSelector(selector),
      kind: selector.kind,
      label:
        selector.kind === "any"
          ? "any device"
          : selector.kind === "device"
            ? (names.get(selector.id) ?? "unknown device")
            : selector.kind === "user"
              ? (users.get(selector.id) ?? "former member")
              : selector.kind === "tag"
                ? `tag:${selector.tag}`
                : selector.kind === "service"
                  ? `service:${selector.name}`
                  : `role:${selector.role}`,
    });
    return {
      defaultAction: network.aclDefaultAction,
      rules: rows.map((row) => ({
        id: row.id,
        protocol: row.protocol,
        portFrom: row.portFrom,
        portTo: row.portTo,
        createdAt: row.createdAt,
        source: describe(selectorOf(row, "source")),
        destination: describe(selectorOf(row, "destination")),
      })),
    };
  }

  async setDefaultAction(organizationId: string, networkId: string, action: AclDefaultAction) {
    await this.networkInOrganization(organizationId, networkId);
    await this.db
      .update(networks)
      .set({ aclDefaultAction: action })
      .where(eq(networks.id, networkId));
    this.events.publishAclChange(networkId);
    return { defaultAction: action };
  }

  async createRule(organizationId: string, networkId: string, input: CreateAclRuleInput) {
    await this.networkInOrganization(organizationId, networkId);
    const source = parseSelector(input.source);
    const destination = parseSelector(input.destination);
    if (!source || !destination) {
      const path = source ? "destination" : "source";
      throw new ValidationError(
        [
          {
            path,
            message: "Use *, device:<id>, tag:<name>, user:<id>, role:<role> or service:<name>",
          },
        ],
        "Invalid selector",
      );
    }
    for (const selector of [source, destination]) {
      await this.assertSelectorTarget(organizationId, networkId, selector);
    }
    if (source.kind === "device" && destination.kind === "device" && source.id === destination.id) {
      throw new ValidationError(
        [{ path: "destination", message: "A device always reaches itself" }],
        "A device always reaches itself",
      );
    }
    const [rule] = await this.db
      .insert(aclRules)
      .values({
        networkId,
        ...selectorColumns("source", source),
        ...selectorColumns("destination", destination),
        protocol: input.protocol,
        portFrom: input.portFrom ?? null,
        portTo: input.portFrom === undefined ? null : (input.portTo ?? input.portFrom),
      })
      .returning({ id: aclRules.id });
    this.events.publishAclChange(networkId);
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
      .returning({ id: aclRules.id, networkId: aclRules.networkId });
    if (!deleted) throw new NotFoundError("acl_rule");
    this.events.publishAclChange(deleted.networkId);
  }

  /**
   * Members' roles or memberships changed: rules naming roles or users may
   * now match other devices, so every agent in the organization re-reads its
   * rules.
   */
  async membershipChanged(organizationId: string) {
    const rows = await this.db
      .select({ id: networks.id })
      .from(networks)
      .where(eq(networks.organizationId, organizationId));
    for (const { id } of rows) this.events.publishAclChange(id);
  }

  /**
   * What may reach a device, for its agent: the network's default action and,
   * when that is "deny", the rules whose destination matches it, with sources
   * resolved to mesh addresses (null: any peer). `peers` are the ids of the
   * devices it may talk to in either direction (null: every device), so its
   * network map leaves out the rest.
   */
  async policyFor(networkId: string, deviceId: string) {
    const [network] = await this.db
      .select({ defaultAction: networks.aclDefaultAction })
      .from(networks)
      .where(eq(networks.id, networkId));
    if (!network || network.defaultAction === "allow") {
      return { acl: { defaultAction: "allow" as const, inbound: [] }, peers: null };
    }
    const { rules, devices: all } = await this.load(networkId);
    const self = all.find((d) => d.id === deviceId);
    return {
      acl: { defaultAction: "deny" as const, inbound: self ? inboundRules(rules, all, self) : [] },
      peers: new Set(self ? relatedPeers(rules, all, self).map((d) => d.id) : []),
    };
  }

  /** Whether one device may connect to another, and the rule that allows it. */
  async check(organizationId: string, networkId: string, input: CheckAccessInput) {
    const network = await this.networkInOrganization(organizationId, networkId);
    const { rules, devices: all } = await this.load(networkId);
    const source = all.find((d) => d.id === input.sourceDeviceId);
    const destination = all.find((d) => d.id === input.destinationDeviceId);
    if (!source || !destination) throw new NotFoundError("device");
    const result = check(
      network.aclDefaultAction,
      rules,
      source,
      destination,
      input.protocol,
      input.port ?? null,
    );
    return { allowed: result.allowed, ruleIndex: result.rule };
  }

  /**
   * The policy as a readable document: selectors with device names and user
   * emails instead of ids, ports as "22" or "8000-8999".
   */
  async document(organizationId: string, networkId: string) {
    const network = await this.networkInOrganization(organizationId, networkId);
    const { rows, names, emails } = await this.load(networkId);
    const text = (selector: Selector) =>
      selector.kind === "device"
        ? `device:${names.get(selector.id) ?? selector.id}`
        : selector.kind === "user"
          ? `user:${emails.get(selector.id) ?? selector.id}`
          : formatSelector(selector);
    return {
      defaultAction: network.aclDefaultAction,
      rules: rows.map((row) => ({
        source: text(selectorOf(row, "source")),
        destination: text(selectorOf(row, "destination")),
        protocol: row.protocol,
        ports:
          row.portFrom === null
            ? "*"
            : row.portTo === null || row.portTo === row.portFrom
              ? String(row.portFrom)
              : `${row.portFrom}-${row.portTo}`,
      })),
    };
  }

  /** The network's rules and devices, with each device owner's roles. */
  private async load(networkId: string) {
    const [network] = await this.db
      .select({ organizationId: networks.organizationId })
      .from(networks)
      .where(eq(networks.id, networkId));
    if (!network) throw new NotFoundError("network");
    const rows = await this.db
      .select()
      .from(aclRules)
      .where(eq(aclRules.networkId, networkId))
      .orderBy(aclRules.createdAt);
    const deviceRows = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        tags: devices.tags,
        userId: devices.userId,
        meshIpv4: devices.meshIpv4,
        meshIpv6: devices.meshIpv6,
        role: member.role,
      })
      .from(devices)
      .leftJoin(
        member,
        and(eq(member.userId, devices.userId), eq(member.organizationId, network.organizationId)),
      )
      .where(eq(devices.networkId, networkId))
      .orderBy(devices.createdAt);
    const hostRows = await this.db
      .select({ deviceId: serviceHosts.deviceId, name: services.name })
      .from(serviceHosts)
      .innerJoin(services, eq(services.id, serviceHosts.serviceId))
      .where(eq(services.networkId, networkId));
    const hosted = new Map<string, string[]>();
    for (const { deviceId, name } of hostRows)
      hosted.set(deviceId, [...(hosted.get(deviceId) ?? []), name]);
    const userIds = rows.flatMap((r) => [r.sourceUserId, r.destinationUserId]).filter(Boolean);
    const userRows =
      userIds.length === 0
        ? []
        : await this.db
            .select({ id: user.id, name: user.name, email: user.email })
            .from(user)
            .where(inArray(user.id, userIds as string[]));

    const rules: PolicyRule[] = rows.map((row) => ({
      source: selectorOf(row, "source"),
      destination: selectorOf(row, "destination"),
      protocol: row.protocol,
      portFrom: row.portFrom,
      portTo: row.portTo,
    }));
    const policyDevices: PolicyDevice[] = deviceRows.map(({ name: _, role, ...d }) => ({
      ...d,
      roles: role ? role.split(",") : [],
      services: hosted.get(d.id) ?? [],
    }));
    return {
      rows,
      rules,
      devices: policyDevices,
      names: new Map(deviceRows.map((d) => [d.id, d.name])),
      users: new Map(userRows.map((u) => [u.id, u.name || u.email])),
      emails: new Map(userRows.map((u) => [u.id, u.email])),
    };
  }

  /** A device or user a rule names must be in the network or organization. */
  private async assertSelectorTarget(organizationId: string, networkId: string, s: Selector) {
    if (s.kind === "device") {
      const [found] = await this.db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.networkId, networkId), eq(devices.id, s.id)));
      if (!found) throw new NotFoundError("device");
    }
    if (s.kind === "service") {
      const [found] = await this.db
        .select({ id: services.id })
        .from(services)
        .where(and(eq(services.networkId, networkId), eq(services.name, s.name)));
      if (!found) throw new NotFoundError("service");
    }
    if (s.kind === "user") {
      const [found] = await this.db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, s.id)));
      if (!found) throw new NotFoundError("member");
    }
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
