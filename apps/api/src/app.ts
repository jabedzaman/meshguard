import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Auth } from "@mesh/auth";
import type { Db } from "@mesh/db";
import type { AppEnv } from "~/env";
import { sessionMiddleware } from "~/middleware/auth";
import { networksRoutes } from "~/routes/networks";

export interface AppDeps {
  db: Db;
  auth: Auth;
  /** Browser origins allowed to call the API with cookies. */
  corsOrigins: string[];
}

// Routes must be chained so their types accumulate into AppType, which
// @mesh/api-client uses to type every request and response.
export function createApp({ db, auth, corsOrigins }: AppDeps) {
  return new Hono<AppEnv>()
    .use(logger())
    .use(cors({ origin: corsOrigins, credentials: true }))
    .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
    .use(sessionMiddleware(auth))
    .get("/healthz", (c) => c.json({ ok: true }))
    .route("/v1/networks", networksRoutes(db));
}

export type AppType = ReturnType<typeof createApp>;
