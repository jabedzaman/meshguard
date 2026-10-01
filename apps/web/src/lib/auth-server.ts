import { createAuthClient } from "better-auth/client";
import { SERVER_API_URL } from "~/lib/env";

// Better Auth client for server-side code (proxy, server components). Pass the
// incoming request's cookie via fetchOptions.headers.
export const serverAuthClient = createAuthClient({
  baseURL: SERVER_API_URL,
  basePath: "/api/auth",
});
