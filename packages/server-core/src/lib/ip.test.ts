import { describe, expect, it } from "vitest";
import {
  formatIpv4Cidr,
  ipv4CidrSchema,
  isPrivateIpv4Cidr,
  parseIpv4,
  parseIpv4Cidr,
  randomIpv4InCidr,
  randomIpv6InPrefix,
  randomUlaPrefix,
} from "~/lib/ip";

describe("parseIpv4", () => {
  it("parses dotted quads", () => {
    expect(parseIpv4("10.77.0.1")).toBe(0x0a4d0001);
    expect(parseIpv4("255.255.255.255")).toBe(0xffffffff);
  });

  it.each(["10.77.0", "10.77.0.256", "10.77.0.-1", "a.b.c.d", "10.77.0.1.2", ""])(
    "rejects %s",
    (value) => expect(parseIpv4(value)).toBeNull(),
  );
});

describe("parseIpv4Cidr", () => {
  it("round-trips a network address", () => {
    expect(formatIpv4Cidr(parseIpv4Cidr("10.77.0.0/16")!)).toBe("10.77.0.0/16");
  });

  it("rejects host bits", () => {
    expect(parseIpv4Cidr("10.77.1.0/16")).toBeNull();
  });

  it.each(["10.77.0.0", "10.77.0.0/33", "10.77.0.0/", "10.77.0.0/16/1"])("rejects %s", (value) =>
    expect(parseIpv4Cidr(value)).toBeNull(),
  );
});

describe("isPrivateIpv4Cidr", () => {
  it.each(["10.0.0.0/8", "10.77.0.0/16", "172.16.0.0/12", "172.31.0.0/16", "192.168.10.0/24"])(
    "accepts %s",
    (value) => expect(isPrivateIpv4Cidr(parseIpv4Cidr(value)!)).toBe(true),
  );

  it.each(["100.64.0.0/10", "172.32.0.0/16", "8.0.0.0/8", "0.0.0.0/0"])("rejects %s", (value) =>
    expect(isPrivateIpv4Cidr(parseIpv4Cidr(value)!)).toBe(false),
  );
});

describe("ipv4CidrSchema", () => {
  it("accepts the default range", () => {
    expect(ipv4CidrSchema.safeParse("10.77.0.0/16").success).toBe(true);
  });

  it.each([
    ["10.77.1.0/16", "host bits"],
    ["10.77.0.0/25", "Prefix"],
    ["10.0.0.0/7", "Prefix"],
    ["100.64.0.0/16", "private"],
  ])("rejects %s (%s)", (value, message) => {
    const result = ipv4CidrSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(message);
  });
});

describe("randomUlaPrefix", () => {
  it("is an fd00::/8 /48 prefix", () => {
    expect(randomUlaPrefix()).toMatch(/^fd[0-9a-f]{2}:[0-9a-f]{1,4}:[0-9a-f]{1,4}::\/48$/);
  });

  it("is random", () => {
    const prefixes = new Set(Array.from({ length: 100 }, randomUlaPrefix));
    expect(prefixes.size).toBe(100);
  });
});

describe("randomIpv4InCidr", () => {
  it("stays inside the range and skips network/broadcast", () => {
    for (let i = 0; i < 2000; i++) {
      const ip = randomIpv4InCidr("10.77.0.0/30");
      expect(["10.77.0.1", "10.77.0.2"]).toContain(ip);
    }
  });

  it("spreads across a /16", () => {
    const ips = new Set(Array.from({ length: 200 }, () => randomIpv4InCidr("10.77.0.0/16")));
    expect(ips.size).toBeGreaterThan(190);
    for (const ip of ips) expect(ip.startsWith("10.77.")).toBe(true);
  });

  it("never hands out the DNS resolver's address", () => {
    // A /26 has 62 hosts, so 2000 draws would hit .53 with near certainty.
    const ips = new Set(Array.from({ length: 2000 }, () => randomIpv4InCidr("10.77.0.0/26")));
    expect(ips).not.toContain("10.77.0.53");
    expect(ips).toContain("10.77.0.54");
    expect(ips).toContain("10.77.0.62");
    expect(ips.size).toBe(61);
  });

  it("rejects ranges with no hosts", () => {
    expect(() => randomIpv4InCidr("10.77.0.0/31")).toThrow();
    expect(() => randomIpv4InCidr("nope")).toThrow();
  });
});

describe("randomIpv6InPrefix", () => {
  it("is inside the /48 on subnet 0", () => {
    const ip = randomIpv6InPrefix("fd12:3456:789a::/48");
    expect(ip).toMatch(/^fd12:3456:789a:0(:[0-9a-f]{1,4}){4}$/);
  });

  it("works with generated prefixes", () => {
    const prefix = randomUlaPrefix();
    const ip = randomIpv6InPrefix(prefix);
    expect(ip.startsWith(prefix.replace("::/48", ":0:"))).toBe(true);
  });
});
