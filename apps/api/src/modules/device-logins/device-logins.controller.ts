import { clientIp } from "~/lib/client-ip";
import { factory } from "~/lib/factory";
import { validate } from "~/lib/validator";
import { rateLimitByIp } from "~/middlewares/rate-limit.middleware";
import { requireAuth, requireOrganization, requirePermission } from "~/middlewares/auth.middleware";
import {
  approveDeviceLoginBody,
  deviceLoginIdParams,
  pollDeviceLoginBody,
  startDeviceLoginBody,
} from "~/modules/device-logins/device-logins.schema";

/** Called by the CLI (`meshguard up` without a token); no session, the secret it gets back is its credential. */
export const start = factory.createHandlers(
  rateLimitByIp("device-login-start", 10, 60_000),
  validate("json", startDeviceLoginBody),
  async (c) => {
    const device = { ...c.req.valid("json"), ip: clientIp(c) };
    return c.json(await c.var.services.deviceLogins.start(device), 201);
  },
);

/** The CLI waits here until the user approves in the web. */
export const poll = factory.createHandlers(
  rateLimitByIp("device-login-poll", 60, 60_000),
  validate("json", pollDeviceLoginBody),
  async (c) => {
    return c.json(await c.var.services.deviceLogins.poll(c.req.valid("json").secret), 200);
  },
);

export const describe = factory.createHandlers(
  requireAuth,
  validate("param", deviceLoginIdParams),
  async (c) => {
    return c.json(await c.var.services.deviceLogins.describe(c.req.valid("param").id), 200);
  },
);

export const approve = factory.createHandlers(
  requireOrganization,
  requirePermission({ device: ["create"] }),
  validate("param", deviceLoginIdParams),
  validate("json", approveDeviceLoginBody),
  async (c) => {
    await c.var.services.deviceLogins.approve(
      { userId: c.var.user.id, organizationId: c.var.organizationId },
      c.req.valid("param").id,
      c.req.valid("json").networkId,
    );
    return c.body(null, 204);
  },
);

export const deny = factory.createHandlers(
  requireAuth,
  validate("param", deviceLoginIdParams),
  async (c) => {
    await c.var.services.deviceLogins.deny(c.req.valid("param").id);
    return c.body(null, 204);
  },
);
