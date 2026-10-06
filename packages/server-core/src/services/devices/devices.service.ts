import type { KeyObject } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, ne, schema, type Db, type SQL } from "@meshguard/db";
import { AppError, ConflictError, NotFoundError } from "~/errors";
import type { DeviceEvents } from "~/events/device-events";
import { isUniqueViolation } from "~/lib/db-errors";
import { deviceNameFromHostname, numberedDeviceName } from "~/lib/device-name";
import { randomIpv4InCidr, randomIpv6InPrefix } from "~/lib/ip";
import type { PresenceStore } from "~/lib/presence";
import { relayTokenExpiry, signRelayToken } from "~/lib/relay-token";
import { hashToken } from "~/lib/tokens";
import type { AclService } from "~/services/acl/acl.service";

const { devices, enrollmentTokens, networks, user } = schema;

/** Address picks before giving up; collisions only matter in nearly full networks. */
const MAX_ADDRESS_ATTEMPTS = 20;

export interface EnrollDeviceInput {
  token: string;
  hostname: string;
  platform: "darwin" | "linux" | "windows";
  /** Base64 Ed25519 public key; the device signs requests with it. */
  identityPublicKey: string;
  /** Base64 Curve25519 public key for WireGuard. */
  wireguardPublicKey: string;
}

export class DevicesService {
  constructor(
    private readonly db: Db,
    private readonly presence: PresenceStore,
    private readonly events: DeviceEvents,
    private readonly acl: AclService,
    private readonly options: {
      relayUrl?: string;
      relayTokenKey?: KeyObject;
      stunServers?: string[];
    } = {},
  ) {}

  /**
   * Redeems an enrollment token and registers the device with random free
   * mesh addresses and a name unique in its network (`laptop`, `laptop-2`, …),
   * which is also its DNS label, owned by the token's creator. The token is
   * consumed in the same transaction, so it can enroll at most one device.
   */
  async enroll(input: EnrollDeviceInput) {
    const enrolled = await this.db.transaction(async (tx) => {
      const [token] = await tx
        .update(enrollmentTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(enrollmentTokens.tokenHash, hashToken(input.token)),
            isNull(enrollmentTokens.usedAt),
            isNull(enrollmentTokens.revokedAt),
            gt(enrollmentTokens.expiresAt, new Date()),
          ),
        )
        .returning({
          id: enrollmentTokens.id,
          networkId: enrollmentTokens.networkId,
          createdBy: enrollmentTokens.createdBy,
        });
      if (!token) {
        throw new AppError(
          401,
          "invalid_enrollment_token",
          "Enrollment token is invalid, expired, revoked or already used",
        );
      }

      const [network] = await tx.select().from(networks).where(eq(networks.id, token.networkId));
      if (!network) throw new NotFoundError("network");

      const baseName = deviceNameFromHostname(input.hostname);
      const taken = new Set(
        (
          await tx
            .select({ name: devices.name })
            .from(devices)
            .where(eq(devices.networkId, network.id))
        ).map((d) => d.name),
      );
      let nameNumber = 1;
      const nextFreeName = () => {
        while (taken.has(numberedDeviceName(baseName, nameNumber))) nameNumber++;
        return numberedDeviceName(baseName, nameNumber);
      };

      for (let attempt = 0; attempt < MAX_ADDRESS_ATTEMPTS; attempt++) {
        const name = nextFreeName();
        try {
          // Savepoint per attempt: a unique violation would otherwise abort the transaction.
          const device = await tx.transaction(async (sp) => {
            const [row] = await sp
              .insert(devices)
              .values({
                networkId: network.id,
                name,
                // Until users sign in from the device, it belongs to whoever made its token.
                userId: token.createdBy,
                hostname: input.hostname,
                platform: input.platform,
                identityPublicKey: input.identityPublicKey,
                wireguardPublicKey: input.wireguardPublicKey,
                meshIpv4: randomIpv4InCidr(network.ipv4Cidr),
                meshIpv6: randomIpv6InPrefix(network.ipv6Cidr),
              })
              .returning();
            return row!;
          });
          await tx
            .update(enrollmentTokens)
            .set({ usedByDeviceId: device.id })
            .where(eq(enrollmentTokens.id, token.id));
          return {
            device,
            network: {
              id: network.id,
              name: network.name,
              ipv4Cidr: network.ipv4Cidr,
              ipv6Cidr: network.ipv6Cidr,
            },
          };
        } catch (error) {
          if (
            isUniqueViolation(error, "devices_identity_public_key_unique") ||
            isUniqueViolation(error, "devices_wireguard_public_key_unique")
          ) {
            throw new ConflictError("device_already_enrolled", "This device is already enrolled");
          }
          if (
            isUniqueViolation(error, "devices_network_id_mesh_ipv4_unique") ||
            isUniqueViolation(error, "devices_network_id_mesh_ipv6_unique")
          ) {
            continue;
          }
          if (isUniqueViolation(error, "devices_network_id_name_unique")) {
            // Taken by a concurrent enrollment.
            taken.add(name);
            continue;
          }
          throw error;
        }
      }
      throw new ConflictError("network_full", "No free address left in this network");
    });
    this.events.publish({
      type: "enrolled",
      networkId: enrolled.network.id,
      deviceId: enrolled.device.id,
    });
    return enrolled;
  }

  /** The device and its identity key, for verifying a signed request. */
  async findForAuth(deviceId: string) {
    const [device] = await this.db
      .select({
        id: devices.id,
        networkId: devices.networkId,
        identityPublicKey: devices.identityPublicKey,
      })
      .from(devices)
      .where(eq(devices.id, deviceId));
    return device ?? null;
  }

  /**
   * Records the device's presence and reachable endpoints and returns its
   * network map: the device itself plus every peer's WireGuard key, mesh
   * addresses and endpoints, and what may reach it. Presence goes to Redis; Postgres is only written
   * when the endpoints change or lastSeenAt is due to be persisted.
   */
  async sync(deviceId: string, input: { endpoints: string[] }) {
    const [self] = await this.db
      .select({
        id: devices.id,
        networkId: devices.networkId,
        name: devices.name,
        meshIpv4: devices.meshIpv4,
        meshIpv6: devices.meshIpv6,
        wireguardPublicKey: devices.wireguardPublicKey,
        endpoints: devices.endpoints,
      })
      .from(devices)
      .where(eq(devices.id, deviceId));
    if (!self) throw new NotFoundError("device");

    const now = new Date();
    const presence = await this.presence.touch(self.networkId, self.id, now);
    const endpointsChanged = !sameEndpoints(self.endpoints, input.endpoints);
    if (endpointsChanged || presence.persist) {
      await this.db
        .update(devices)
        .set({
          ...(endpointsChanged && { endpoints: input.endpoints }),
          ...(presence.persist && { lastSeenAt: now }),
        })
        .where(eq(devices.id, self.id));
    }
    if (presence.connected || endpointsChanged) {
      this.events.publish({
        type: presence.connected ? "connected" : "updated",
        networkId: self.networkId,
        deviceId: self.id,
      });
    }

    const [network] = await this.db
      .select({
        id: networks.id,
        name: networks.name,
        ipv4Cidr: networks.ipv4Cidr,
        ipv6Cidr: networks.ipv6Cidr,
      })
      .from(networks)
      .where(eq(networks.id, self.networkId));

    const peers = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        wireguardPublicKey: devices.wireguardPublicKey,
        meshIpv4: devices.meshIpv4,
        meshIpv6: devices.meshIpv6,
        endpoints: devices.endpoints,
        lastSeenAt: devices.lastSeenAt,
      })
      .from(devices)
      .where(and(eq(devices.networkId, self.networkId), ne(devices.id, self.id)))
      .orderBy(devices.createdAt);
    const seen = await this.presence.lastSeen(
      self.networkId,
      peers.map((peer) => peer.id),
    );

    return {
      self: {
        id: self.id,
        name: self.name,
        meshIpv4: self.meshIpv4,
        meshIpv6: self.meshIpv6,
      },
      network: network!,
      peers: peers.map((peer) => ({ ...peer, lastSeenAt: seen.get(peer.id) ?? peer.lastSeenAt })),
      /** Traffic from peers the agent lets in. */
      acl: await this.acl.policyFor(self.networkId, self.id),
      /** Where to relay WireGuard packets for peers that can't be reached directly. */
      relay: this.relayFor(self.wireguardPublicKey, now),
      /** STUN servers for discovering this device's public address. */
      stun: this.options.stunServers ?? [],
    };
  }

  /** The relay and, with a token key, this device's permission to use it. */
  private relayFor(wireguardPublicKey: string, now: Date) {
    const { relayUrl, relayTokenKey } = this.options;
    if (!relayUrl) return null;
    if (!relayTokenKey) return { url: relayUrl };
    return {
      url: relayUrl,
      token: signRelayToken(relayTokenKey, wireguardPublicKey, relayTokenExpiry(now)),
    };
  }

  /** A device leaving its network (`meshguard logout`). */
  async deleteSelf(deviceId: string) {
    await this.removeOne(eq(devices.id, deviceId));
  }

  /**
   * Removes a device in the organization (from the web). Peers drop it on
   * their next sync; the device's own syncs are refused from then on.
   */
  async remove(organizationId: string, deviceId: string) {
    await this.removeOne(
      and(eq(devices.id, deviceId), inArray(devices.networkId, this.networksIn(organizationId))),
    );
  }

  /** Removes every device a user owns in the organization, e.g. when they leave it. */
  async removeOwnedBy(organizationId: string, userId: string) {
    return this.removeWhere(
      and(eq(devices.userId, userId), inArray(devices.networkId, this.networksIn(organizationId))),
    );
  }

  /** Who owns a device in the organization (null: no one). */
  async ownerOf(organizationId: string, deviceId: string) {
    const [device] = await this.db
      .select({ userId: devices.userId })
      .from(devices)
      .where(
        and(eq(devices.id, deviceId), inArray(devices.networkId, this.networksIn(organizationId))),
      );
    if (!device) throw new NotFoundError("device");
    return device.userId;
  }

  private async removeOne(where: SQL | undefined) {
    const [deleted] = await this.removeWhere(where);
    if (!deleted) throw new NotFoundError("device");
  }

  private async removeWhere(where: SQL | undefined) {
    const deleted = await this.db
      .delete(devices)
      .where(where)
      .returning({ id: devices.id, networkId: devices.networkId });
    for (const device of deleted) {
      await this.presence.clear(device.networkId, device.id);
      this.events.publish({ type: "removed", networkId: device.networkId, deviceId: device.id });
    }
    return deleted;
  }

  /**
   * Renames a device in the organization. The name is its DNS label, so it
   * must stay unique in the network; agents pick it up on their next sync.
   */
  async rename(organizationId: string, deviceId: string, name: string) {
    try {
      const [device] = await this.db
        .update(devices)
        .set({ name })
        .where(
          and(
            eq(devices.id, deviceId),
            inArray(devices.networkId, this.networksIn(organizationId)),
          ),
        )
        .returning({ id: devices.id, networkId: devices.networkId, name: devices.name });
      if (!device) throw new NotFoundError("device");
      this.events.publish({ type: "updated", networkId: device.networkId, deviceId: device.id });
      return device;
    } catch (error) {
      if (isUniqueViolation(error, "devices_network_id_name_unique")) {
        throw new ConflictError(
          "device_name_taken",
          `Another device in this network is named ${name}`,
        );
      }
      throw error;
    }
  }

  /** Live device events for a network in the organization; call `close` when done. */
  async subscribe(organizationId: string, networkId: string) {
    await this.assertNetworkInOrganization(organizationId, networkId);
    return this.events.subscribe(networkId);
  }

  async listForNetwork(organizationId: string, networkId: string) {
    await this.assertNetworkInOrganization(organizationId, networkId);

    const rows = await this.db
      .select({
        id: devices.id,
        networkId: devices.networkId,
        name: devices.name,
        hostname: devices.hostname,
        platform: devices.platform,
        meshIpv4: devices.meshIpv4,
        meshIpv6: devices.meshIpv6,
        endpoints: devices.endpoints,
        lastSeenAt: devices.lastSeenAt,
        createdAt: devices.createdAt,
        ownerId: user.id,
        ownerName: user.name,
        ownerEmail: user.email,
      })
      .from(devices)
      .leftJoin(user, eq(devices.userId, user.id))
      .where(eq(devices.networkId, networkId))
      .orderBy(desc(devices.createdAt));

    // Online means the device's presence key hasn't expired. Decided here, not
    // in the browser, so the response changes when a device goes stale.
    const seen = await this.presence.lastSeen(
      networkId,
      rows.map((row) => row.id),
    );
    return rows.map(({ ownerId, ownerName, ownerEmail, ...row }) => {
      const lastSeenAt = seen.get(row.id);
      return {
        ...row,
        owner: ownerId ? { id: ownerId, name: ownerName!, email: ownerEmail! } : null,
        lastSeenAt: lastSeenAt ?? row.lastSeenAt,
        online: lastSeenAt !== undefined,
      };
    });
  }

  /** Subquery: ids of the organization's networks. */
  private networksIn(organizationId: string) {
    return this.db
      .select({ id: networks.id })
      .from(networks)
      .where(eq(networks.organizationId, organizationId));
  }

  private async assertNetworkInOrganization(organizationId: string, networkId: string) {
    const [network] = await this.db
      .select({ id: networks.id })
      .from(networks)
      .where(and(eq(networks.id, networkId), eq(networks.organizationId, organizationId)));
    if (!network) throw new NotFoundError("network");
  }
}

function sameEndpoints(a: string[], b: string[]) {
  return a.length === b.length && a.every((endpoint, i) => endpoint === b[i]);
}
