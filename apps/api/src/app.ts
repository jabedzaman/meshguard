import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import type { Auth } from "@mesh/auth";
import type { Db } from "@mesh/db";
import { createServices } from "@mesh/server-core";
import { sessionMiddleware } from "~/middlewares/auth.middleware";
import { errorHandler, notFoundHandler } from "~/middlewares/error.middleware";
import { loggingMiddleware } from "~/middlewares/logging.middleware";
import { v1Routes } from "~/routes/v1";
import type { AppEnv } from "~/types";

export interface AppDeps {
  db: Db;
  auth: Auth;
  /** Browser origins allowed to call the API with cookies. */
  corsOrigins: string[];
  /** Relay URL handed to agents. */
  relayUrl?: string;
  /** STUN servers handed to agents. */
  stunServers?: string[];
}

// Routes must be chained so their types accumulate into AppType, which
// @mesh/api-client uses to type every request and response.
export function createApp({ db, auth, corsOrigins, relayUrl, stunServers }: AppDeps) {
  const services = createServices(db, { relayUrl, stunServers });

  return new Hono<AppEnv>()
    .onError(errorHandler)
    .notFound(notFoundHandler)
    .use(requestId())
    .use(loggingMiddleware)
    .use(cors({ origin: corsOrigins, credentials: true, exposeHeaders: ["X-Request-Id"] }))
    .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
    .use(async (c, next) => {
      c.set("auth", auth);
      c.set("services", services);
      await next();
    })
    .use(sessionMiddleware(auth))
    .get("/healthz", (c) => c.json({ ok: true }))
    .route("/v1", v1Routes);
}

export type AppType = ReturnType<typeof createApp>;
export type { ErrorBody } from "~/middlewares/error.middleware";
