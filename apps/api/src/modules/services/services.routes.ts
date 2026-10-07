import { Hono } from "hono";
import * as controller from "~/modules/services/services.controller";
import type { AppEnv } from "~/types";

/** Mounted at /v1/services. */
export const servicesRoutes = new Hono<AppEnv>()
  .put("/:id/hosts", ...controller.setHosts)
  .delete("/:id", ...controller.remove);

/** Nested under the networks router: /v1/networks/:networkId/services. */
export const networkServicesRoutes = new Hono<AppEnv>()
  .get("/", ...controller.list)
  .post("/", ...controller.create);
