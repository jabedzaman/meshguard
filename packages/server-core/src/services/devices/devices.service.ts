import { and, desc, eq, gt, isNull, ne, schema, type Db } from "@mesh/db";
import { AppError, ConflictError, NotFoundError } from "~/errors";
import { isUniqueViolation } from "~/lib/db-errors";
import { randomIpv4InCidr, randomIpv6InPrefix } from "~/lib/ip";
import { hashToken } from "~/lib/tokens";

const { devices, enrollmentTokens, networks } = schema;

/** A device is online if it synced within this window (agents sync every 10s). */
export const ONLINE_WINDOW_MS = 30_000;

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
  constructor(private readonly db: Db) {}

  /**
   * Redeems an enrollment token and registers the device with random free
   * mesh addresses. The token is consumed in the same transaction, so it can
   * enroll at most one device.
   */
  async enroll(input: EnrollDeviceInput) {
    return await this.db.transaction(async (tx) => {
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
        .returning({ id: enrollmentTokens.id, networkId: enrollmentTokens.networkId });
      if (!token) {
        throw new AppError(
          401,
          "invalid_enrollment_token",
          "Enrollment token is invalid, expired, revoked or already used",
        );
      }

      const [network] = await tx.select().from(networks).where(eq(networks.id, token.networkId));
      if (!network) throw new NotFoundError("network");

      for (let attempt = 0; attempt < MAX_ADDRESS_ATTEMPTS; attempt++) {
        try {
          // Savepoint per attempt: a unique violation would otherwise abort the transaction.
          const device = await tx.transaction(async (sp) => {
            const [row] = await sp
              .insert(devices)
              .values({
                networkId: network.id,
                name: input.hostname,
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
          throw error;
        }
      }
      throw new ConflictError("network_full", "No free address left in this network");
    });
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
   * Records the device's reachable endpoints and returns its network map: the
   * device itself plus every peer's WireGuard key, mesh addresses and endpoints.
   */
  async sync(deviceId: string, input: { endpoints: string[] }) {
    const [self] = await this.db
      .update(devices)
      .set({ endpoints: input.endpoints, lastSeenAt: new Date() })
      .where(eq(devices.id, deviceId))
      .returning();
    if (!self) throw new NotFoundError("device");

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

    return {
      self: {
        id: self.id,
        name: self.name,
        meshIpv4: self.meshIpv4,
        meshIpv6: self.meshIpv6,
      },
      network: network!,
      peers,
    };
  }

  async listForNetwork(organizationId: string, networkId: string) {
    const [network] = await this.db
      .select({ id: networks.id })
      .from(networks)
      .where(and(eq(networks.id, networkId), eq(networks.organizationId, organizationId)));
    if (!network) throw new NotFoundError("network");

    return await this.db
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
      })
      .from(devices)
      .where(eq(devices.networkId, networkId))
      .orderBy(desc(devices.createdAt));
  }
}
