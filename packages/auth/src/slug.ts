/**
 * Organization slugs are subdomains (`<slug>.meshguard.dev`), so they follow
 * DNS label rules and can't take a name the platform already uses.
 */
export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$/;

/** Hostnames the platform serves itself, which an organization must not shadow. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "api",
  "app",
  "admin",
  "auth",
  "mail",
  "relay",
  "mesh",
  "docs",
  "status",
  "support",
  "help",
  "blog",
  "dashboard",
  "login",
  "signin",
  "signup",
  "static",
  "assets",
  "cdn",
  "localhost",
]);

/** An error message when `slug` can't be used, or null when it can. */
export function slugError(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) {
    return "Use 3–32 lowercase letters, numbers or hyphens, starting and ending with a letter or number.";
  }
  if (RESERVED_SLUGS.has(slug)) return "That name is reserved.";
  return null;
}

/** A slug suggestion from an organization name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32)
    .replace(/-$/, "");
}
