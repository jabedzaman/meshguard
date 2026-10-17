import { Hono } from "hono";
import * as controller from "~/modules/acl/acl.controller";
import type { AppEnv } from "~/types";

/** Nested under the network router: /v1/network/acl. */
export const networkAclRoutes = new Hono<AppEnv>()
  .get("/", ...controller.getForNetwork)
  .patch("/", ...controller.updateForNetwork)
  .post("/rules", ...controller.createRule)
  .get("/document", ...controller.document)
  .post("/check", ...controller.check);

/** Mounted at /v1/acl-rules. */
export const aclRulesRoutes = new Hono<AppEnv>().delete("/:id", ...controller.removeRule);
