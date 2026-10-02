import { Hono } from "hono";
import { networkAclRoutes } from "~/modules/acl/acl.routes";
import { networkDevicesRoutes } from "~/modules/devices/devices.routes";
import { networkEnrollmentTokensRoutes } from "~/modules/enrollment-tokens/enrollment-tokens.routes";
import * as controller from "~/modules/networks/networks.controller";
import type { AppEnv } from "~/types";

export const networksRoutes = new Hono<AppEnv>()
  .get("/", ...controller.list)
  .post("/", ...controller.create)
  .get("/:id", ...controller.get)
  .route("/:networkId/enrollment-tokens", networkEnrollmentTokensRoutes)
  .route("/:networkId/devices", networkDevicesRoutes)
  .route("/:networkId/acl", networkAclRoutes);
