import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "~/lib/auth";

// Data loaders for server components. Routing on auth state happens in
// proxy.ts, so these don't redirect. Wrapped in React cache() so components
// rendering in the same request share one lookup each.

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export const getActiveOrganization = cache(async () =>
  auth.api.getFullOrganization({ headers: await headers() }),
);
