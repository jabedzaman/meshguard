import { createHash, randomBytes } from "node:crypto";

export const ENROLLMENT_TOKEN_PREFIX = "mesh_enr_";

/** A new enrollment token: 32 random bytes, base64url, with a recognizable prefix. */
export function generateEnrollmentToken(): string {
  return `${ENROLLMENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Tokens are stored as SHA-256 hashes; they're random, so no salt is needed. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Enough of the token to tell tokens apart in a list, without being usable. */
export function tokenDisplayPrefix(token: string): string {
  return token.slice(0, ENROLLMENT_TOKEN_PREFIX.length + 6);
}
