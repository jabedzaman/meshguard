import { Hono } from "hono";
import { aclRulesRoutes } from "~/modules/acl/acl.routes";
import { deviceLoginsRoutes } from "~/modules/device-logins/device-logins.routes";
import { devicesRoutes } from "~/modules/devices/devices.routes";
import { enrollmentTokensRoutes } from "~/modules/enrollment-tokens/enrollment-tokens.routes";
import { servicesRoutes } from "~/modules/services/services.routes";
import { networksRoutes } from "~/modules/networks/networks.routes";
import type { AppEnv } from "~/types";

/** Every /v1 route. Feature routers own their nested paths. */
export const v1Routes = new Hono<AppEnv>()
  .route("/networks", networksRoutes)
  .route("/enrollment-tokens", enrollmentTokensRoutes)
  .route("/devices", devicesRoutes)
  .route("/device-logins", deviceLoginsRoutes)
  .route("/services", servicesRoutes)
  .route("/acl-rules", aclRulesRoutes);
