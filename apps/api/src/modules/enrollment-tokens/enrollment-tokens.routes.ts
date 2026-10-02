import { Hono } from "hono";
import * as controller from "~/modules/enrollment-tokens/enrollment-tokens.controller";
import type { AppEnv } from "~/types";

/** Nested under the networks router: /v1/networks/:networkId/enrollment-tokens. */
export const networkEnrollmentTokensRoutes = new Hono<AppEnv>()
  .get("/", ...controller.listForNetwork)
  .post("/", ...controller.createForNetwork);

/** Mounted at /v1/enrollment-tokens. */
export const enrollmentTokensRoutes = new Hono<AppEnv>().delete("/:id", ...controller.revoke);
