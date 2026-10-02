import { Hono } from "hono";
import * as controller from "~/modules/networks/networks.controller";
import type { AppEnv } from "~/types";

export const networksRoutes = new Hono<AppEnv>()
  .get("/", ...controller.list)
  .post("/", ...controller.create)
  .get("/:id", ...controller.get);
