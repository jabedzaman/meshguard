import { describe, expect, it } from "vitest";
import { deviceNameFromHostname, numberedDeviceName } from "~/lib/device-name";

describe("deviceNameFromHostname", () => {
  it("keeps the first label, lowercased", () => {
    expect(deviceNameFromHostname("Jabeds-MacBook-Air.local")).toBe("jabeds-macbook-air");
  });

  it("replaces characters DNS doesn't allow", () => {
    expect(deviceNameFromHostname("my_box (2)")).toBe("my-box-2");
  });

  it("falls back when nothing usable is left", () => {
    expect(deviceNameFromHostname("--")).toBe("device");
    expect(deviceNameFromHostname("")).toBe("device");
  });

  it("fits in one DNS label", () => {
    expect(deviceNameFromHostname("a".repeat(80))).toHaveLength(63);
  });
});

describe("numberedDeviceName", () => {
  it("numbers from 2", () => {
    expect(numberedDeviceName("laptop", 1)).toBe("laptop");
    expect(numberedDeviceName("laptop", 2)).toBe("laptop-2");
  });

  it("stays within one DNS label", () => {
    expect(numberedDeviceName("a".repeat(63), 12)).toBe(`${"a".repeat(60)}-12`);
  });
});
