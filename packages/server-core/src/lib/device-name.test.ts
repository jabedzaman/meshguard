import { describe, expect, it } from "vitest";
import { DEVICE_NAME_PATTERN, deviceNameFromHostname, numberedDeviceName } from "~/lib/device-name";

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

describe("DEVICE_NAME_PATTERN", () => {
  it("accepts DNS labels", () => {
    for (const name of ["a", "laptop", "build-box-2", "a".repeat(63)]) {
      expect(DEVICE_NAME_PATTERN.test(name)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const name of ["", "-a", "a-", "Laptop", "my_box", "a.b", "a".repeat(64)]) {
      expect(DEVICE_NAME_PATTERN.test(name)).toBe(false);
    }
  });

  it("matches what hostnames turn into", () => {
    expect(DEVICE_NAME_PATTERN.test(deviceNameFromHostname("Jabeds-MacBook-Air.local"))).toBe(true);
    expect(DEVICE_NAME_PATTERN.test(numberedDeviceName("a".repeat(63), 12))).toBe(true);
  });
});
