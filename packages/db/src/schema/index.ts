import {
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";

// Human auth tables (users, sessions, organizations, members) are owned by
// Better Auth and generated into ./auth.ts by `pnpm --filter @mesh/auth
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
    name: text("name").notNull(),
    hostname: text("hostname").notNull(),
    platform: platform("platform").notNull(),
    // Device identity: the agent's long-lived signing key, separate from its WireGuard key.
    identityPublicKey: text("identity_public_key").notNull().unique(),
    wireguardPublicKey: text("wireguard_public_key").notNull().unique(),
    meshIpv4: inet("mesh_ipv4"),
    meshIpv6: inet("mesh_ipv6"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("devices_network_id_idx").on(t.networkId),
    // Lets concurrent enrollments pick random addresses and retry on conflict
    // instead of coordinating through a central allocator.
    unique("devices_network_id_mesh_ipv4_unique").on(t.networkId, t.meshIpv4),
    unique("devices_network_id_mesh_ipv6_unique").on(t.networkId, t.meshIpv6),
  ],
);
