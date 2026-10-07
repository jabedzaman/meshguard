import { adjectives, animals, uniqueNamesGenerator } from "unique-names-generator";

/** Base domain when DNS_BASE_DOMAIN isn't set. */
export const DEFAULT_DNS_BASE_DOMAIN = "lvh.me";

/**
 * A random DNS label for a network, like Tailscale's tailnet names:
 * `brave-otter`. Unique across all networks (the caller retries on a clash),
 * and says nothing about the organization or network it names.
 */
export function randomNetworkLabel(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: "-",
    style: "lowerCase",
  });
}

/**
 * The domain a network's devices resolve under: `<label>.<base>`, so a device
 * is `laptop.brave-otter.lvh.me`, and `laptop` alone through the search domain.
 */
export function networkDnsDomain(label: string, baseDomain: string): string {
  return `${label}.${baseDomain}`;
}
