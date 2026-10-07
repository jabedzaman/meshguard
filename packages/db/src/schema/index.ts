import { sql } from "drizzle-orm";
import {
  check,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

// Human auth tables (users, sessions, organizations, members) are owned by
// Better Auth and generated into ./auth.ts by `pnpm --filter @meshguard/auth
// auth:generate`. Don't edit that file by hand. Device identity lives here and
// never touches them.
export * from "./auth";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** What happens to traffic between devices that no access rule allows. */
export const aclDefaultAction = pgEnum("acl_default_action", ["allow", "deny"]);

export const networks = pgTable(
  "networks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Every network may use the same IPv4 range; addresses are only unique
    // within a network. The IPv6 /48 is random per network.
    ipv4Cidr: text("ipv4_cidr").notNull(),
    ipv6Cidr: text("ipv6_cidr").notNull().unique(),
    /** "allow": every device reaches every other; "deny": only what acl_rules allow. */
    aclDefaultAction: aclDefaultAction("acl_default_action").notNull().default("allow"),
    ...timestamps,
  },
  (t) => [
    index("networks_organization_id_idx").on(t.organizationId),
    unique("networks_organization_id_name_unique").on(t.organizationId, t.name),
  ],
);

export const platform = pgEnum("platform", ["darwin", "linux", "windows"]);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    /** Unique in the network and a DNS label: the device resolves as `<name>.internal`. */
    name: text("name").notNull(),
    /**
     * The user the device belongs to: whoever created its enrollment token.
     * Removing them from the organization removes their devices. Null for
     * devices that belong to no one (none yet; tagged devices later).
     */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /**
     * Tags (without "tag:") that access rules can name. Set by owners and
     * admins only, since they grant access.
     */
    tags: text("tags").array().notNull().default([]),
    hostname: text("hostname").notNull(),
    platform: platform("platform").notNull(),
    // Device identity: the agent's long-lived signing key, separate from its WireGuard key.
    identityPublicKey: text("identity_public_key").notNull().unique(),
    wireguardPublicKey: text("wireguard_public_key").notNull().unique(),
    meshIpv4: inet("mesh_ipv4"),
    meshIpv6: inet("mesh_ipv6"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    /** UDP "host:port" addresses peers can try to reach this device's WireGuard on, best first. */
    endpoints: jsonb("endpoints").$type<string[]>().notNull().default([]),
    /** Last sync, persisted every few minutes; live presence is in Redis (see PresenceStore). */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("devices_network_id_idx").on(t.networkId),
    index("devices_user_id_idx").on(t.userId),
    // Lets concurrent enrollments pick random addresses and retry on conflict
    // instead of coordinating through a central allocator.
    unique("devices_network_id_mesh_ipv4_unique").on(t.networkId, t.meshIpv4),
    unique("devices_network_id_mesh_ipv6_unique").on(t.networkId, t.meshIpv6),
    unique("devices_network_id_name_unique").on(t.networkId, t.name),
  ],
);

/**
 * One-time tokens a device uses to join a network (`meshguard up --token ...`).
 * Only a hash is stored; the token is shown once when created.
 */
export const enrollmentTokens = pgTable(
  "enrollment_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** SHA-256 of the token, hex. */
    tokenHash: text("token_hash").notNull().unique(),
    /** First characters of the token, for telling tokens apart in lists. */
    tokenPrefix: text("token_prefix").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedByDeviceId: uuid("used_by_device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("enrollment_tokens_network_id_idx").on(t.networkId)],
);

export const aclProtocol = pgEnum("acl_protocol", ["any", "tcp", "udp", "icmp"]);

/** Roles a rule can name: devices owned by members with that role. */
export const aclRole = pgEnum("acl_role", ["owner", "admin", "member"]);

/**
 * Lets traffic from a source reach a destination on a protocol and port
 * range. Each side names at most one of a device, a tag, a user (their
 * devices) or a role (devices of members with it); none means any device.
 * Only enforced when the network's default action is "deny". Rules naming a
 * device or user go away with it.
 */
export const aclRules = pgTable(
  "acl_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    networkId: uuid("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    sourceDeviceId: uuid("source_device_id").references(() => devices.id, {
      onDelete: "cascade",
    }),
    sourceTag: text("source_tag"),
    sourceUserId: text("source_user_id").references(() => user.id, { onDelete: "cascade" }),
    sourceRole: aclRole("source_role"),
    destinationDeviceId: uuid("destination_device_id").references(() => devices.id, {
      onDelete: "cascade",
    }),
    destinationTag: text("destination_tag"),
    destinationUserId: text("destination_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    destinationRole: aclRole("destination_role"),
    protocol: aclProtocol("protocol").notNull().default("any"),
    /** TCP/UDP destination ports, inclusive; null for every port. */
    portFrom: integer("port_from"),
    portTo: integer("port_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("acl_rules_network_id_idx").on(t.networkId),
    check(
      "acl_rules_one_source",
      sql`num_nonnulls(${t.sourceDeviceId}, ${t.sourceTag}, ${t.sourceUserId}, ${t.sourceRole}) <= 1`,
    ),
    check(
      "acl_rules_one_destination",
      sql`num_nonnulls(${t.destinationDeviceId}, ${t.destinationTag}, ${t.destinationUserId}, ${t.destinationRole}) <= 1`,
    ),
  ],
);
