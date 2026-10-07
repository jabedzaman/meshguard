import { describe, expect, it } from "vitest";
import { parseRoutePrefix } from "~/lib/route-prefix";

const mesh = "10.77.0.0/16";

describe("parseRoutePrefix", () => {
  it("accepts canonical private and public subnets", () => {
    expect(parseRoutePrefix("192.168.1.0/24", mesh)).toBe("192.168.1.0/24");
    expect(parseRoutePrefix("10.9.0.0/16", mesh)).toBe("10.9.0.0/16");
    expect(parseRoutePrefix("2001:db8::/32", mesh)).toBe("2001:db8::/32");
  });

  it("rejects what a subnet router can't carry", () => {
    for (const bad of [
      "192.168.1.5/24", // host bits
      "0.0.0.0/0",
      "::/0",
      "10.77.4.0/24", // inside the mesh
      "10.0.0.0/8", // covers the mesh
      "127.0.0.0/8",
      "169.254.0.0/16",
      "224.0.0.0/4",
      "fe80::/10",
      "fd00:1:2::/48",
      "nonsense",
      "192.168.1.0",
      "192.168.1.0/33",
    ]) {
      expect(parseRoutePrefix(bad, mesh), bad).toBeNull();
    }
  });
});
