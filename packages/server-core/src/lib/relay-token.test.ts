import { describe, expect, it } from "vitest";
import {
  RELAY_TOKEN_PERIOD_MS,
  relayTokenExpiry,
  relayTokenKey,
  signRelayToken,
} from "~/lib/relay-token";

describe("relay tokens", () => {
  it("matches the Go relay's token", () => {
    // Same seed, key and expiry as TestTokenVector in internal/relay/token_test.go.
    const key = relayTokenKey(Buffer.from("meshguard relay token test seed!").toString("base64"));
    const wireguardKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64");
    expect(signRelayToken(key, wireguardKey, new Date(1_800_000_000_000))).toBe(
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8AAAAAa0nSAE6KW3P3EEBJFa_SkxIcjTa-5udWIeLoeurNqPAu1peF7AMC2uY70lXmrCmvSM-8G3QAcg_hAH0vTbDAzFGd_QQ",
    );
  });

  it("matches the Go relay's token with public names", () => {
    // Same as TestTokenWithNamesVector in internal/relay/token_test.go.
    const key = relayTokenKey(Buffer.from("meshguard relay token test seed!").toString("base64"));
    const wireguardKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64");
    expect(
      signRelayToken(key, wireguardKey, new Date(1_800_000_000_000), [
        "a.example.com",
        "b.example.com",
      ]),
    ).toBe(
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8AAAAAa0nSAAINYS5leGFtcGxlLmNvbQ1iLmV4YW1wbGUuY29tZfKTS-r2hYKPO5PPQ3ENWLZP1mSUj4xfkwlo6NwtZdMRuO8cco56ceyudAAy_jw7aINbvVxqbKDnALa-EsDLAA",
    );
  });

  it("refuses too many or empty public names", () => {
    const key = relayTokenKey(Buffer.from("meshguard relay token test seed!").toString("base64"));
    const wg = Buffer.alloc(32).toString("base64");
    const now = new Date();
    expect(() => signRelayToken(key, wg, now, Array(9).fill("a.example.com"))).toThrow();
    expect(() => signRelayToken(key, wg, now, [""])).toThrow();
  });

  it("rejects a seed of the wrong length", () => {
    expect(() => relayTokenKey("c2hvcnQ=")).toThrow();
  });

  it("expires one to two periods ahead, the same within a period", () => {
    const start = new Date(10 * RELAY_TOKEN_PERIOD_MS);
    const later = new Date(start.getTime() + RELAY_TOKEN_PERIOD_MS - 1);
    expect(relayTokenExpiry(start).getTime()).toBe(12 * RELAY_TOKEN_PERIOD_MS);
    expect(relayTokenExpiry(later)).toEqual(relayTokenExpiry(start));
    expect(relayTokenExpiry(later).getTime() - later.getTime()).toBeGreaterThan(
      RELAY_TOKEN_PERIOD_MS,
    );
  });
});
