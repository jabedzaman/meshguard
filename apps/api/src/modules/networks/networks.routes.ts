import { Hono } from "hono";
import { networkAclRoutes } from "~/modules/acl/acl.routes";
import { networkDevicesRoutes } from "~/modules/devices/devices.routes";
import { networkEnrollmentTokensRoutes } from "~/modules/enrollment-tokens/enrollment-tokens.routes";
import { networkServicesRoutes } from "~/modules/services/services.routes";
import { networkConnectorsRoutes } from "~/modules/connectors/connectors.routes";
import * as controller from "~/modules/networks/networks.controller";
import type { AppEnv } from "~/types";

/** The active organization's network: /v1/network. */
export const networkRoutes = new Hono<AppEnv>()
  .get("/", ...controller.get)
  .route("/enrollment-tokens", networkEnrollmentTokensRoutes)
  .route("/devices", networkDevicesRoutes)
  .route("/services", networkServicesRoutes)
  .route("/connectors", networkConnectorsRoutes)
  .route("/acl", networkAclRoutes);
