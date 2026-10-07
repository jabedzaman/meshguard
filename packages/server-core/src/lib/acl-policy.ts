/**
 * Access policy evaluation, in memory over one network's devices. A rule's
 * source and destination are selectors: any device, one device, a tag, a
 * user's devices or the devices of members with a role. Agents only ever get
 * the result (sources resolved to mesh addresses), so selectors can grow
 * without agent changes.
 */

export const ACL_ROLES = ["owner", "admin", "member"] as const;
export type AclRole = (typeof ACL_ROLES)[number];

/** A tag without its "tag:" prefix: a DNS-label-like name. */
export const TAG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export type Selector =
  | { kind: "any" }
  | { kind: "device"; id: string }
  | { kind: "tag"; tag: string }
  | { kind: "user"; id: string }
  | { kind: "role"; role: AclRole };

/** What a selector needs to know about a device. */
export interface PolicyDevice {
  id: string;
  tags: string[];
  /** Owner; null for a device that belongs to no one. */
  userId: string | null;
  /** The owner's roles in the network's organization. */
  roles: string[];
  meshIpv4: string | null;
  meshIpv6: string | null;
}

export interface PolicyRule {
  source: Selector;
  destination: Selector;
  protocol: "any" | "tcp" | "udp" | "icmp";
  portFrom: number | null;
  portTo: number | null;
}

/** Selector as text: `*`, `device:<id>`, `tag:<name>`, `user:<id>`, `role:<role>`. */
export function formatSelector(selector: Selector): string {
  switch (selector.kind) {
    case "any":
      return "*";
    case "device":
      return `device:${selector.id}`;
    case "tag":
      return `tag:${selector.tag}`;
    case "user":
      return `user:${selector.id}`;
    case "role":
      return `role:${selector.role}`;
  }
}

/** Parses formatSelector's text; null if it isn't a selector. */
export function parseSelector(text: string): Selector | null {
  if (text === "*") return { kind: "any" };
  const [kind, value] = [text.slice(0, text.indexOf(":")), text.slice(text.indexOf(":") + 1)];
  if (!value) return null;
  switch (kind) {
    case "device":
      return { kind, id: value };
    case "tag":
      return TAG_PATTERN.test(value) ? { kind, tag: value } : null;
    case "user":
      return { kind, id: value };
    case "role":
      return (ACL_ROLES as readonly string[]).includes(value)
        ? { kind, role: value as AclRole }
        : null;
    default:
      return null;
  }
}

export function matches(selector: Selector, device: PolicyDevice): boolean {
  switch (selector.kind) {
    case "any":
      return true;
    case "device":
      return device.id === selector.id;
    case "tag":
      return device.tags.includes(selector.tag);
    case "user":
      return device.userId === selector.id;
    case "role":
      return device.roles.includes(selector.role);
  }
}

function addresses(device: PolicyDevice) {
  return [device.meshIpv4, device.meshIpv6].filter((ip): ip is string => ip !== null);
}

/**
 * The rules letting traffic in to `self`, for its agent: sources resolved to
 * the mesh addresses of matching peers (null: any peer). A rule whose source
 * matches no other device is left out.
 */
export function inboundRules(rules: PolicyRule[], devices: PolicyDevice[], self: PolicyDevice) {
  return rules
    .filter((rule) => matches(rule.destination, self))
    .flatMap((rule) => {
      const sources =
        rule.source.kind === "any"
          ? null
          : devices.filter((d) => d.id !== self.id && matches(rule.source, d)).flatMap(addresses);
      if (sources !== null && sources.length === 0) return [];
      return [{ sources, protocol: rule.protocol, portFrom: rule.portFrom, portTo: rule.portTo }];
    });
}

/**
 * Whether `source` may open a connection to `destination` on the protocol
 * and port, and the first rule that allows it (null with the default action
 * "allow", or when nothing does).
 */
export function check(
  defaultAction: "allow" | "deny",
  rules: PolicyRule[],
  source: PolicyDevice,
  destination: PolicyDevice,
  protocol: "tcp" | "udp" | "icmp",
  port: number | null,
) {
  if (defaultAction === "allow") return { allowed: true, rule: null };
  const index = rules.findIndex(
    (rule) =>
      matches(rule.source, source) &&
      matches(rule.destination, destination) &&
      (rule.protocol === "any" || rule.protocol === protocol) &&
      (rule.portFrom === null ||
        (port !== null && port >= rule.portFrom && port <= (rule.portTo ?? rule.portFrom))),
  );
  return { allowed: index !== -1, rule: index === -1 ? null : index };
}
