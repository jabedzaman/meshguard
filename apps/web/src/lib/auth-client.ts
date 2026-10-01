import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { API_URL } from "~/lib/env";

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: "/api/auth",
  plugins: [organizationClient()],
});

/**
 * Better Auth client calls resolve to `{ data, error }` instead of throwing.
 * Unwrap them so they can be used as TanStack Query mutation functions.
 */
export async function unwrap<T>(
  call: Promise<{ data: T; error: null } | { data: null; error: { message?: string } }>,
): Promise<T> {
  const { data, error } = await call;
  if (error) throw new Error(error.message ?? "Something went wrong.");
  return data as T;
}
