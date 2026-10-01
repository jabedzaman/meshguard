import { DetailedError, hc } from "hono/client";
import type { AppType, ErrorBody } from "@mesh/api";

export { DetailedError, parseResponse } from "hono/client";
export type { ErrorBody };
export type { InferRequestType, InferResponseType } from "hono/client";

export interface ApiClientOptions {
  /** Extra headers, e.g. forwarding the incoming `cookie` header from a Next.js server component. */
  headers?:
    Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
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

/** The API's error body from an error thrown by parseResponse, if there is one. */
export function getApiError(error: unknown): ErrorBody["error"] | null {
  if (!(error instanceof DetailedError)) return null;
  const data = (error.detail as { data?: Partial<ErrorBody> } | undefined)?.data;
  return data?.error ?? null;
}

/** A message suitable for showing to users, preferring the API's own message. */
export function getErrorMessage(error: unknown): string {
  return (
    getApiError(error)?.message ?? (error instanceof Error ? error.message : "Something went wrong")
  );
}
