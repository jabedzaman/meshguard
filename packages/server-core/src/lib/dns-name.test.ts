import { describe, expect, it } from "vitest";
import { DEVICE_NAME_PATTERN } from "~/lib/device-name";
import { networkDnsDomain, randomNetworkLabel } from "~/lib/dns-name";

describe("randomNetworkLabel", () => {
  it("is one DNS label of two words", () => {
    for (let i = 0; i < 200; i++) {
      const label = randomNetworkLabel();
      expect(label).toMatch(DEVICE_NAME_PATTERN);
      expect(label.split("-")).toHaveLength(2);
    }
  });
});

describe("networkDnsDomain", () => {
  it("puts the label under the base domain", () => {
    expect(networkDnsDomain("brave-otter", "lvh.me")).toBe("brave-otter.lvh.me");
  });
});
