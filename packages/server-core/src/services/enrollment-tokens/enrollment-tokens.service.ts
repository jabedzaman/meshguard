import { and, desc, eq, gt, isNull, or, schema, type Db } from "@meshguard/db";
import { ForbiddenError, NotFoundError } from "~/errors";
import { generateEnrollmentToken, hashToken, tokenDisplayPrefix } from "~/lib/tokens";

const { enrollmentTokens, networks, user } = schema;

export const ENROLLMENT_TOKEN_TTLS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
} as const;

export interface EnrollmentTokenOptions {
  /** Enrolls any number of devices instead of one. */
  reusable?: boolean;
  /** The devices it enrolls are removed automatically after being offline a while. */
  ephemeral?: boolean;
  /** Tags (without "tag:") the devices it enrolls start with. */
  tags?: string[];
  /** The devices it enrolls skip the network's device approval. */
  preApproved?: boolean;
}

export type EnrollmentTokenTtl = keyof typeof ENROLLMENT_TOKEN_TTLS;

export interface Actor {
  userId: string;
  organizationId: string;
}

export class EnrollmentTokensService {
  constructor(private readonly db: Db) {}

  private async assertNetworkInOrganization(organizationId: string, networkId: string) {
    const [network] = await this.db
      .select({ id: networks.id })
      .from(networks)
      .where(and(eq(networks.id, networkId), eq(networks.organizationId, organizationId)));
    if (!network) throw new NotFoundError("network");
  }

  /** Creates a token. The plaintext is returned only here; only its hash is stored. */
  async create(
    actor: Actor,
    networkId: string,
    ttl: EnrollmentTokenTtl,
    { reusable = false, ephemeral = false, tags = [], preApproved = false }: EnrollmentTokenOptions = {},
  ) {
    await this.assertNetworkInOrganization(actor.organizationId, networkId);
    const token = generateEnrollmentToken();
    const [row] = await this.db
      .insert(enrollmentTokens)
      .values({
        networkId,
        createdBy: actor.userId,
        tokenHash: hashToken(token),
        tokenPrefix: tokenDisplayPrefix(token),
        expiresAt: new Date(Date.now() + ENROLLMENT_TOKEN_TTLS[ttl]),
        reusable,
        ephemeral,
        preApproved,
        tags: [...new Set(tags)].sort(),
      })
      .returning({
        id: enrollmentTokens.id,
        networkId: enrollmentTokens.networkId,
        tokenPrefix: enrollmentTokens.tokenPrefix,
        expiresAt: enrollmentTokens.expiresAt,
        reusable: enrollmentTokens.reusable,
        ephemeral: enrollmentTokens.ephemeral,
        preApproved: enrollmentTokens.preApproved,
        tags: enrollmentTokens.tags,
        createdAt: enrollmentTokens.createdAt,
      });
    return { ...row!, token };
  }

  /** Tokens that can still be used: not used up, revoked or expired. */
  async listActive(organizationId: string, networkId: string) {
    await this.assertNetworkInOrganization(organizationId, networkId);
    return await this.db
      .select({
        id: enrollmentTokens.id,
        networkId: enrollmentTokens.networkId,
        tokenPrefix: enrollmentTokens.tokenPrefix,
        expiresAt: enrollmentTokens.expiresAt,
        createdAt: enrollmentTokens.createdAt,
        reusable: enrollmentTokens.reusable,
        ephemeral: enrollmentTokens.ephemeral,
        preApproved: enrollmentTokens.preApproved,
        tags: enrollmentTokens.tags,
        uses: enrollmentTokens.uses,
        createdBy: { id: user.id, name: user.name, email: user.email },
      })
      .from(enrollmentTokens)
      .innerJoin(user, eq(user.id, enrollmentTokens.createdBy))
      .where(
        and(
          eq(enrollmentTokens.networkId, networkId),
          or(eq(enrollmentTokens.reusable, true), isNull(enrollmentTokens.usedAt)),
          isNull(enrollmentTokens.revokedAt),
          gt(enrollmentTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(enrollmentTokens.createdAt));
  }

  /**
   * Revokes a token in the actor's organization. Anyone can revoke their own;
   * `canRevokeOthers` (device:delete) is needed for other people's.
   */
  async revoke(actor: Actor, tokenId: string, { canRevokeOthers }: { canRevokeOthers: boolean }) {
    const [token] = await this.db
      .select({ id: enrollmentTokens.id, createdBy: enrollmentTokens.createdBy })
      .from(enrollmentTokens)
      .innerJoin(networks, eq(networks.id, enrollmentTokens.networkId))
      .where(
        and(eq(enrollmentTokens.id, tokenId), eq(networks.organizationId, actor.organizationId)),
      );
    if (!token) throw new NotFoundError("enrollment_token");
    if (token.createdBy !== actor.userId && !canRevokeOthers) {
      throw new ForbiddenError(
        "insufficient_permissions",
        "Only admins can revoke other people's tokens",
      );
    }
    await this.db
      .update(enrollmentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(enrollmentTokens.id, tokenId), isNull(enrollmentTokens.revokedAt)));
  }
}
