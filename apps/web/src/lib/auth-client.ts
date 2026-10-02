import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, roles } from "@meshguard/auth/permissions";
import { API_URL } from "~/lib/env";

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: "/api/auth",
  plugins: [organizationClient({ ac, roles })],
});

/**
 * Better Auth client calls resolve to `{ data, error }` instead of throwing.
 * Unwrap them so they can be used as TanStack Query mutation functions.
 */
export async function unwrap<T>(
  call: Promise<{ data: T; error: null } | { data: null; error: { message?: string } }>,
): Promise<NonNullable<T>> {
  const { data, error } = await call;
  if (error) throw new Error(error.message ?? "Something went wrong.");
  if (data == null) throw new Error("Empty response from the auth server.");
  return data;
}
