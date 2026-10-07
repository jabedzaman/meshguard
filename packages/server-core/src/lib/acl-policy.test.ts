import { describe, expect, it } from "vitest";
import {
  check,
  formatSelector,
  inboundRules,
  matches,
  parseSelector,
  relatedPeers,
  type PolicyDevice,
  type PolicyRule,
} from "~/lib/acl-policy";

const device = (id: string, fields: Partial<PolicyDevice> = {}): PolicyDevice => ({
  id,
  tags: [],
  userId: null,
  roles: [],
  meshIpv4: `10.77.0.${id.length}`,
  meshIpv6: null,
  ...fields,
});

const laptop = device("laptop", { userId: "alice", roles: ["member"], meshIpv4: "10.77.0.2" });
const desktop = device("desktop", { userId: "bob", roles: ["admin"], meshIpv4: "10.77.0.3" });
const db = device("db", { tags: ["server", "db"], meshIpv4: "10.77.0.4" });
const web = device("web", { tags: ["server"], meshIpv4: "10.77.0.5" });
const all = [laptop, desktop, db, web];

const rule = (source: string, destination: string, fields: Partial<PolicyRule> = {}) =>
  ({
    source: parseSelector(source)!,
    destination: parseSelector(destination)!,
    protocol: "any",
    portFrom: null,
    portTo: null,
    ...fields,
  }) satisfies PolicyRule;

describe("selectors", () => {
  it.each(["*", "device:d1", "tag:server", "user:u1", "role:admin"])("round-trips %s", (text) => {
    expect(formatSelector(parseSelector(text)!)).toBe(text);
  });

  it.each(["", "tag:", "tag:Server", "tag:-x", "role:root", "group:x", "device"])(
    "rejects %j",
    (text) => {
      expect(parseSelector(text)).toBeNull();
    },
  );

  it("matches devices by id, tag, owner and owner's role", () => {
    expect(all.filter((d) => matches(parseSelector("tag:server")!, d))).toEqual([db, web]);
    expect(all.filter((d) => matches(parseSelector("user:alice")!, d))).toEqual([laptop]);
    expect(all.filter((d) => matches(parseSelector("role:admin")!, d))).toEqual([desktop]);
    expect(all.filter((d) => matches(parseSelector("device:web")!, d))).toEqual([web]);
    expect(all.filter((d) => matches(parseSelector("*")!, d))).toEqual(all);
  });
});

describe("inboundRules", () => {
  const rules = [
    rule("role:admin", "tag:server"),
    rule("user:alice", "tag:db", { protocol: "tcp", portFrom: 5432, portTo: 5432 }),
    rule("*", "device:web", { protocol: "tcp", portFrom: 443, portTo: 443 }),
    rule("tag:nothing", "*"),
  ];

  it("gives each destination its rules with sources as addresses", () => {
    expect(inboundRules(rules, all, db)).toEqual([
      { sources: ["10.77.0.3"], protocol: "any", portFrom: null, portTo: null },
      { sources: ["10.77.0.2"], protocol: "tcp", portFrom: 5432, portTo: 5432 },
    ]);
    expect(inboundRules(rules, all, web)).toEqual([
      { sources: ["10.77.0.3"], protocol: "any", portFrom: null, portTo: null },
      { sources: null, protocol: "tcp", portFrom: 443, portTo: 443 },
    ]);
    // Nothing names the laptop, and a source matching no device is dropped.
    expect(inboundRules(rules, all, laptop)).toEqual([]);
  });

  it("never lists the destination as its own source", () => {
    expect(inboundRules([rule("tag:server", "tag:server")], all, db)).toEqual([
      { sources: ["10.77.0.5"], protocol: "any", portFrom: null, portTo: null },
    ]);
  });
});

describe("check", () => {
  const rules = [
    rule("role:admin", "tag:server"),
    rule("user:alice", "tag:db", { protocol: "tcp", portFrom: 5432, portTo: 5433 }),
  ];

  it("finds the first rule that allows a connection", () => {
    expect(check("deny", rules, desktop, web, "tcp", 22)).toEqual({ allowed: true, rule: 0 });
    expect(check("deny", rules, laptop, db, "tcp", 5433)).toEqual({ allowed: true, rule: 1 });
    expect(check("deny", rules, laptop, db, "tcp", 22)).toEqual({ allowed: false, rule: null });
    expect(check("deny", rules, laptop, db, "udp", 5432)).toEqual({ allowed: false, rule: null });
    expect(check("deny", rules, laptop, db, "icmp", null)).toEqual({ allowed: false, rule: null });
    expect(check("allow", [], laptop, db, "tcp", 22)).toEqual({ allowed: true, rule: null });
  });
});

describe("relatedPeers", () => {
  it("lists peers a rule connects in either direction", () => {
    const rules = [rule("role:admin", "tag:server"), rule("user:alice", "tag:db")];
    expect(relatedPeers(rules, all, laptop)).toEqual([db]);
    expect(relatedPeers(rules, all, desktop)).toEqual([db, web]);
    expect(relatedPeers(rules, all, db)).toEqual([laptop, desktop]);
    expect(relatedPeers(rules, all, web)).toEqual([desktop]);
    expect(relatedPeers([], all, web)).toEqual([]);
    expect(relatedPeers([rule("*", "*", { protocol: "icmp" })], all, web)).toEqual([
      laptop,
      desktop,
      db,
    ]);
  });
});
