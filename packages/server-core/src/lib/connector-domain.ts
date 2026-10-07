/** Domains an app connector may carry. */
export const MAX_CONNECTOR_DOMAINS = 32;
export const MAX_CONNECTORS_PER_NETWORK = 32;

const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN = new RegExp(`^(${LABEL}\\.)+[a-z]{2,63}$`);

/**
 * A connector domain, lower case: at least two labels (so no whole top-level
 * domains), no wildcard and no trailing dot. It covers itself and every name
 * under it. Returns null if it isn't one.
 */
export function parseConnectorDomain(text: string): string | null {
  const domain = text.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return domain.length <= 253 && DOMAIN.test(domain) ? domain : null;
}
