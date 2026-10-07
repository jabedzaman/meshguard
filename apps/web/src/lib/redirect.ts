/** Query param holding where to go once the current auth step is done. */
export const REDIRECT_PARAM = "redirectTo";

/** Query flag that lets a signed-in user open the auth pages to add an account. */
export const ADD_ACCOUNT_PARAM = "addAccount";

/** Only same-origin paths, so ?redirectTo= can't send users to another site. */
export function safeRedirect(target: string | null | undefined) {
  return target?.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\")
    ? target
    : "/";
}

/** `path` carrying `target` as its redirect, or plain `path` when target is the default. */
export function withRedirect(path: string, target: string | null | undefined) {
  const safe = safeRedirect(target);
  if (safe === "/") return path;
  const url = new URL(path, "http://n");
  url.searchParams.set(REDIRECT_PARAM, safe);
  return `${url.pathname}${url.search}`;
}
