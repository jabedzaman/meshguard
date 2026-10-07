/** Longest DNS label (RFC 1035). */
const MAX_LABEL = 63;

/** A device name: one DNS label of lowercase letters, digits and inner hyphens. */
export const DEVICE_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Turns a hostname into a device name that is also a DNS label, so the device
 * resolves as `<name>.<network domain>`: lowercase letters, digits and inner hyphens.
 */
export function deviceNameFromHostname(hostname: string): string {
  const [first = ""] = hostname.split(".");
  const label = first
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, MAX_LABEL)
    .replace(/^-+|-+$/g, "");
  return label || "device";
}

/** The n-th candidate for a taken name: `name`, `name-2`, `name-3`, … kept within one label. */
export function numberedDeviceName(name: string, n: number): string {
  if (n <= 1) return name;
  const suffix = `-${n}`;
  return name.slice(0, MAX_LABEL - suffix.length).replace(/-+$/, "") + suffix;
}
