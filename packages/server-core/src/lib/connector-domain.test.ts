import { describe, expect, it } from "vitest";
import { parseConnectorDomain } from "~/lib/connector-domain";

describe("parseConnectorDomain", () => {
  it("accepts domains, folding case and the usual decorations", () => {
    expect(parseConnectorDomain("Corp.Example.COM")).toBe("corp.example.com");
    expect(parseConnectorDomain("*.corp.example.com")).toBe("corp.example.com");
    expect(parseConnectorDomain("corp.example.com.")).toBe("corp.example.com");
    expect(parseConnectorDomain(" example.org ")).toBe("example.org");
  });

  it("refuses what isn't one domain", () => {
    for (const bad of [
      "",
      "com",
      "localhost",
      "-bad.example.com",
      "exa mple.com",
      "a..b.com",
      "http://example.com",
      "example.com/path",
      "10.0.0.1",
      "example.c",
      `${"a".repeat(64)}.example.com`,
    ]) {
      expect(parseConnectorDomain(bad), bad).toBeNull();
    }
  });
});
