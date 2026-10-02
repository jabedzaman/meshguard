import { describe, expect, it } from "vitest";
import {
  ENROLLMENT_TOKEN_PREFIX,
  generateEnrollmentToken,
  hashToken,
  tokenDisplayPrefix,
} from "~/lib/tokens";

describe("enrollment tokens", () => {
  it("are prefixed, url-safe and unique", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateEnrollmentToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(new RegExp(`^${ENROLLMENT_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`));
    }
  });

  it("hash deterministically to hex", () => {
    const token = generateEnrollmentToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toBe(hashToken(generateEnrollmentToken()));
  });

  it("display prefix keeps 6 characters after the prefix", () => {
    expect(tokenDisplayPrefix("mesh_enr_abcdefghijk")).toBe("mesh_enr_abcdef");
  });
});
