import { requireNetwork } from "~/middlewares/network.middleware";
import { factory } from "~/lib/factory";
import { validate } from "~/lib/validator";
import {
  hasPermission,
  requireOrganization,
  requirePermission,
} from "~/middlewares/auth.middleware";
import { createEnrollmentTokenBody } from "~/modules/enrollment-tokens/enrollment-tokens.schema";
import { idParams } from "~/schemas/params.schema";

export const listForNetwork = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["read"] }),
  requireNetwork,
  async (c) => {
    const tokens = await c.var.services.enrollmentTokens.listActive(
      c.var.organizationId,
      c.var.networkId,
    );
    return c.json(tokens, 200);
  },
);

export const createForNetwork = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["create"] }),
  requireNetwork,
  validate("json", createEnrollmentTokenBody),
  async (c) => {
    const token = await c.var.services.enrollmentTokens.create(
      { userId: c.var.user.id, organizationId: c.var.organizationId },
      c.var.networkId,
      c.req.valid("json").expiresIn,
    );
    return c.json(token, 201);
  },
);

export const revoke = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["create"] }),
  validate("param", idParams),
  async (c) => {
    await c.var.services.enrollmentTokens.revoke(
      { userId: c.var.user.id, organizationId: c.var.organizationId },
      c.req.valid("param").id,
      { canRevokeOthers: await hasPermission(c, { device: ["delete"] }) },
    );
    return c.body(null, 204);
  },
);
