import { Hono } from "hono";
import * as controller from "~/modules/acl/acl.controller";
import type { AppEnv } from "~/types";

/** Nested under the networks router: /v1/networks/:networkId/acl. */
export const networkAclRoutes = new Hono<AppEnv>()
  .get("/", ...controller.getForNetwork)
  .patch("/", ...controller.updateForNetwork)
  .post("/rules", ...controller.createRule);

/** Mounted at /v1/acl-rules. */
export const aclRulesRoutes = new Hono<AppEnv>().delete("/:id", ...controller.removeRule);
