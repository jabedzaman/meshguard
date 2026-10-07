import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { AppError, TooManyRequestsError } from "@meshguard/server-core";
import { logger } from "~/lib/logger";
import type { AppEnv } from "~/types";

/** Shape of every error response from the API. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get("requestId");

  if (err instanceof TooManyRequestsError) c.header("Retry-After", String(err.retryAfter));

  if (err instanceof AppError) {
    return c.json<ErrorBody>(
      { error: { code: err.code, message: err.message, details: err.details, requestId } },
      err.status,
    );
  }

  // Thrown by Hono itself (e.g. malformed JSON body) and some middleware.
  if (err instanceof HTTPException) {
    return c.json<ErrorBody>(
      { error: { code: "http_error", message: err.message, requestId } },
      err.status,
    );
  }

  // Unexpected: log everything, return nothing internal.
  logger.error({ err, requestId, method: c.req.method, path: c.req.path }, "unhandled error");
  return c.json<ErrorBody>(
    { error: { code: "internal_error", message: "Something went wrong", requestId } },
    500,
  );
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json<ErrorBody>(
    {
      error: {
        code: "route_not_found",
        message: `${c.req.method} ${c.req.path} not found`,
        requestId: c.get("requestId"),
      },
    },
    404,
  );
