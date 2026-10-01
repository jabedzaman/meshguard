import { hc } from "hono/client";
import type { AppType } from "@mesh/api";

export { DetailedError, parseResponse } from "hono/client";
export type { InferRequestType, InferResponseType } from "hono/client";

export interface ApiClientOptions {
  /** Extra headers, e.g. forwarding the incoming `cookie` header from a Next.js server component. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: typeof fetch;
}

export function createApiClient(baseUrl: string, options: ApiClientOptions = {}) {
  return hc<AppType>(baseUrl, {
    ...options,
    // Send the Better Auth session cookie on cross-origin browser requests.
    init: { credentials: "include" },
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
