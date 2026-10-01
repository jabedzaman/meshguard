import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "~/lib/auth";

// Wrapped in React cache() so a layout and page rendering in the same request
// share one lookup each.

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export const listOrganizations = cache(async () =>
  auth.api.listOrganizations({ headers: await headers() }),
);

/** Null when the session has no active organization or it no longer exists. */
export const getActiveOrganization = cache(async () =>
  auth.api.getFullOrganization({ headers: await headers() }).catch(() => null),
);
