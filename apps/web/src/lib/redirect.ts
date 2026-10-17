/** Query param holding where to go once the current auth step is done. */
export const REDIRECT_PARAM = "redirectTo";

/** Query flag that lets a signed-in user open the auth pages to add an account. */
export const ADD_ACCOUNT_PARAM = "addAccount";

/**
 * The host organizations are served under. On the server that's
 * WEB_ROOT_DOMAIN; in the browser, sign-in and onboarding only run on the
 * root domain, so it's the current host.
 */
function rootHost() {
  return typeof window === "undefined"
    ? process.env.WEB_ROOT_DOMAIN || undefined
    : window.location.host;
}

/** An absolute URL on the root domain or one of its organization subdomains. */
function orgUrl(target: string) {
  const root = rootHost();
  if (!root) return null;
  try {
    const url = new URL(target);
    const onRoot = url.host === root || url.host.endsWith(`.${root}`);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      onRoot
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Only same-origin paths, or URLs on an organization's subdomain, so
 * ?redirectTo= can't send users to another site.
 */
export function safeRedirect(target: string | null | undefined) {
  if (!target) return "/";
  if (target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\")) {
    return target;
  }
  return orgUrl(target) ?? "/";
}

/** `path` carrying `target` as its redirect, or plain `path` when target is the default. */
export function withRedirect(path: string, target: string | null | undefined) {
  const safe = safeRedirect(target);
  if (safe === "/") return path;
  const url = new URL(path, "http://n");
  url.searchParams.set(REDIRECT_PARAM, safe);
  return `${url.pathname}${url.search}`;
}
