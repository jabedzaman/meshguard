import { z } from "zod";

/** Default IPv4 range for every network. Ranges only need to be unique within a network. */
export const DEFAULT_IPV4_CIDR = "10.77.0.0/16";

export interface Ipv4Cidr {
  /** Network address as an unsigned 32-bit integer. */
  address: number;
  prefix: number;
}

export function parseIpv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result;
}

export function formatIpv4(address: number): string {
  return [24, 16, 8, 0].map((shift) => (address >>> shift) & 0xff).join(".");
}

function mask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Parses "a.b.c.d/n". Returns null if malformed or if host bits are set. */
export function parseIpv4Cidr(value: string): Ipv4Cidr | null {
  const [ip, prefixText, ...rest] = value.split("/");
  if (!ip || !prefixText || rest.length > 0 || !/^\d{1,2}$/.test(prefixText)) return null;
  const address = parseIpv4(ip);
  const prefix = Number(prefixText);
  if (address === null || prefix > 32) return null;
  if ((address & ~mask(prefix)) >>> 0 !== 0) return null;
  return { address, prefix };
}

export function formatIpv4Cidr({ address, prefix }: Ipv4Cidr): string {
  return `${formatIpv4(address)}/${prefix}`;
}

/** True if `inner` lies entirely within `outer`. */
export function ipv4CidrContains(outer: Ipv4Cidr, inner: Ipv4Cidr): boolean {
  return (
    inner.prefix >= outer.prefix && (inner.address & mask(outer.prefix)) >>> 0 === outer.address
  );
}

const PRIVATE_IPV4_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map((cidr) =>
  parseIpv4Cidr(cidr)!,
);

/** RFC 1918 private ranges only. */
export function isPrivateIpv4Cidr(cidr: Ipv4Cidr): boolean {
  return PRIVATE_IPV4_RANGES.some((range) => ipv4CidrContains(range, cidr));
}

/** Smallest network is a /24; larger than a /8 is never needed. */
export const MIN_IPV4_PREFIX = 8;
export const MAX_IPV4_PREFIX = 24;

/** Validates a network's IPv4 range from user input. */
export const ipv4CidrSchema = z.string().superRefine((value, ctx) => {
  const cidr = parseIpv4Cidr(value);
  if (!cidr) {
    ctx.addIssue({
      code: "custom",
      message: "Must be a network address in CIDR form with no host bits set, e.g. 10.77.0.0/16",
    });
  } else if (cidr.prefix < MIN_IPV4_PREFIX || cidr.prefix > MAX_IPV4_PREFIX) {
    ctx.addIssue({
      code: "custom",
      message: `Prefix must be between /${MIN_IPV4_PREFIX} and /${MAX_IPV4_PREFIX}`,
    });
  } else if (!isPrivateIpv4Cidr(cidr)) {
    ctx.addIssue({
      code: "custom",
      message: "Must be within a private range: 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16",
    });
  }
});

/**
 * A random IPv6 unique local /48 prefix (RFC 4193): fd00::/8 plus a 40-bit
 * random global ID, so prefixes don't collide between networks.
 */
export function randomUlaPrefix(): string {
  const id = crypto.getRandomValues(new Uint8Array(5));
  const hex = (...bytes: number[]) =>
    bytes
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .replace(/^0+(?=.)/, "");
  return `fd${id[0]!.toString(16).padStart(2, "0")}:${hex(id[1]!, id[2]!)}:${hex(id[3]!, id[4]!)}::/48`;
}

/**
 * A random host address in the range, excluding the network and broadcast
 * addresses. Callers retry on conflict; the database enforces uniqueness.
 */
export function randomIpv4InCidr(cidr: string): string {
  const parsed = parseIpv4Cidr(cidr);
  if (!parsed || parsed.prefix > 30) throw new Error(`Not a usable IPv4 range: ${cidr}`);
  const hostCount = 2 ** (32 - parsed.prefix) - 2;
  const [random] = crypto.getRandomValues(new Uint32Array(1));
  return formatIpv4(parsed.address + 1 + (random! % hostCount));
}

/**
 * A random address in a /48 ULA prefix: subnet 0, random 64-bit interface id
 * (e.g. fd12:3456:789a:0:xxxx:xxxx:xxxx:xxxx).
 */
export function randomIpv6InPrefix(prefix: string): string {
  const match = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):([0-9a-f]{1,4})::\/48$/i.exec(prefix);
  if (!match) throw new Error(`Not a /48 prefix: ${prefix}`);
  const iid = crypto.getRandomValues(new Uint16Array(4));
  const hextets = [match[1], match[2], match[3], "0", ...Array.from(iid, (h) => h.toString(16))];
  return hextets.join(":");
}
