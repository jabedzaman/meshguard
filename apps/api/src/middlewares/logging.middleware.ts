import { createMiddleware } from "hono/factory";
import { logger } from "~/lib/logger";
import type { AppEnv } from "~/types";

/** One structured log line per request, tagged with the request id. */
export const loggingMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const start = performance.now();
  await next();
  const status = c.res.status;
  const fields = {
    requestId: c.get("requestId"),
    method: c.req.method,
    path: c.req.path,
    status,
    durationMs: Math.round(performance.now() - start),
  };
  if (status >= 500) logger.error(fields, "request failed");
  else if (status >= 400) logger.warn(fields, "request rejected");
  else logger.info(fields, "request");
});
