import { Hono } from "hono";
import * as controller from "~/modules/connectors/connectors.controller";
import type { AppEnv } from "~/types";

/** Mounted at /v1/connectors. */
export const connectorsRoutes = new Hono<AppEnv>()
  .patch("/:id", ...controller.update)
  .delete("/:id", ...controller.remove);

/** Nested under the networks router: /v1/networks/:networkId/connectors. */
export const networkConnectorsRoutes = new Hono<AppEnv>()
  .get("/", ...controller.list)
  .post("/", ...controller.create);
