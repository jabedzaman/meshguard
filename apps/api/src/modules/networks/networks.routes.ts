import { Hono } from "hono";
import * as controller from "~/modules/networks/networks.controller";
import type { AppEnv } from "~/types";

export const networksRoutes = new Hono<AppEnv>()
  .get("/", ...controller.list)
  .get("/:id", ...controller.get);
