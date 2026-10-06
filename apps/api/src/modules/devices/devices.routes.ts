import { Hono } from "hono";
import * as controller from "~/modules/devices/devices.controller";
import type { AppEnv } from "~/types";

/** Mounted at /v1/devices. */
export const devicesRoutes = new Hono<AppEnv>()
  .post("/enroll", ...controller.enroll)
  .post("/self/sync", ...controller.sync)
  .post("/self/watch", ...controller.watch)
  .delete("/self", ...controller.deleteSelf)
  .patch("/:id", ...controller.rename)
  .delete("/:id", ...controller.remove);

/** Nested under the networks router: /v1/networks/:networkId/devices. */
export const networkDevicesRoutes = new Hono<AppEnv>()
  .get("/", ...controller.listForNetwork)
  .get("/events", ...controller.events);
