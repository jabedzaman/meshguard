export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

/**
 * Base class for errors that are safe to show to clients. Transport layers
 * (HTTP, MCP, CLI) map `status` and `code` to their own response format.
 */
export class AppError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(code = "bad_request", message = "Bad request", details?: unknown) {
    super(400, code, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = "Request validation failed") {
    super(400, "validation_failed", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(code = "forbidden", message = "You don't have access to this resource") {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  /** @param resource snake_case resource name, e.g. "network" → code "network_not_found" */
  constructor(resource: string) {
    super(404, `${resource}_not_found`, `${resource.replaceAll("_", " ")} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code = "conflict", message = "Resource already exists") {
    super(409, code, message);
  }
}

export class TooManyRequestsError extends AppError {
  /** @param retryAfter seconds until the caller may try again */
  constructor(readonly retryAfter: number) {
    super(429, "rate_limited", "Too many requests, try again later", { retryAfter });
  }
}
