import { Hono } from "hono";
import * as controller from "~/modules/device-logins/device-logins.controller";
import type { AppEnv } from "~/types";

/** Mounted at /v1/device-logins. */
export const deviceLoginsRoutes = new Hono<AppEnv>()
  .post("/", ...controller.start)
  .post("/poll", ...controller.poll)
  .get("/:id", ...controller.describe)
  .post("/:id/approve", ...controller.approve)
  .post("/:id/deny", ...controller.deny);
