import "server-only";

// Organizations served on their own subdomain: with WEB_ROOT_DOMAIN set to
// meshguard.example.com, the organization with slug `acme` lives at
// acme.meshguard.example.com. Unset, everything stays on WEB_URL.

const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function rootDomain() {
  return process.env.WEB_ROOT_DOMAIN || undefined;
}

/** The organization slug a request's Host header names, or null on the root domain. */
export function orgSlugFromHost(host: string | null): string | null {
  const root = rootDomain();
  if (!root || !host) return null;
  const suffix = `.${root}`;
  if (!host.toLowerCase().endsWith(suffix)) return null;
  const slug = host.slice(0, -suffix.length).toLowerCase();
  return SLUG.test(slug) ? slug : null;
}

/** Absolute URL of `path` on the organization's subdomain; null when subdomains are off. */
export function orgUrl(slug: string, path = "/"): string | null {
  const root = rootDomain();
  if (!root) return null;
  const { protocol } = new URL(process.env.WEB_URL ?? "http://localhost");
  return new URL(path, `${protocol}//${slug}.${root}`).toString();
}

/** Absolute URL of `path` on the root domain (sign-in, onboarding); null when subdomains are off. */
export function rootUrl(path = "/"): string | null {
  const root = rootDomain();
  if (!root) return null;
  const { protocol } = new URL(process.env.WEB_URL ?? "http://localhost");
  return new URL(path, `${protocol}//${root}`).toString();
}
