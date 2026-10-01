import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Db } from "@mesh/db";
import { networksRoutes } from "~/routes/networks";

// Routes must be chained so their types accumulate into AppType, which
// @mesh/api-client uses to type every request and response.
export function createApp(db: Db) {
  return new Hono()
    .use(logger())
    .get("/healthz", (c) => c.json({ ok: true }))
    .route("/v1/networks", networksRoutes(db));
}

export type AppType = ReturnType<typeof createApp>;
