import { isIPv6 } from "node:net";
import { parseIpv4Cidr, type Ipv4Cidr } from "~/lib/ip";

/** The routes of an exit node: everything. Offered by `advertiseExitNode`, never as a subnet. */
export const EXIT_NODE_ROUTES = ["0.0.0.0/0", "::/0"];

/** Routes one device may advertise; keeps the network map small. */
export const MAX_DEVICE_ROUTES = 32;

/**
 * Validates a route a device advertises: a canonical CIDR (no host bits for
 * IPv4), not a default route, not loopback, link-local or multicast, and not
 * overlapping the network's own mesh ranges. Returns the prefix, or null.
 */
export function parseRoutePrefix(value: string, meshIpv4Cidr: string): string | null {
  const [address, bitsText, ...rest] = value.split("/");
  if (!address || !bitsText || rest.length > 0 || !/^\d{1,3}$/.test(bitsText)) return null;
  const bits = Number(bitsText);
  if (bits === 0) return null;

  if (address.includes(":")) {
    // The agent sends netip's canonical form; anything else that parses is kept as is.
    if (!isIPv6(address) || bits > 128) return null;
    const first = address.toLowerCase();
    if (
      first.startsWith("fe8") ||
      first.startsWith("fe9") ||
      first.startsWith("fea") ||
      first.startsWith("feb")
    )
      return null;
    if (first.startsWith("ff") || first === "::1" || first.startsWith("fd")) return null; // ULA is the mesh's own space
    return `${first}/${bits}`;
  }

  const cidr = parseIpv4Cidr(value);
  if (!cidr) return null;
  const first = cidr.address >>> 24;
  if (first === 127 || first >= 224 || (first === 169 && ((cidr.address >>> 16) & 0xff) === 254)) {
    return null;
  }
  const mesh = parseIpv4Cidr(meshIpv4Cidr);
  if (mesh && overlaps(mesh, cidr)) return null;
  return value;
}

function overlaps(a: Ipv4Cidr, b: Ipv4Cidr) {
  const bits = Math.min(a.prefix, b.prefix);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a.address & mask) >>> 0 === (b.address & mask) >>> 0;
}
