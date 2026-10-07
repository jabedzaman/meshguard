import { factory } from "~/lib/factory";
import { validate } from "~/lib/validator";
import { requireOrganization, requirePermission } from "~/middlewares/auth.middleware";
import { checkAccessBody, createAclRuleBody, updateAclBody } from "~/modules/acl/acl.schema";
import { idParams, networkIdParams } from "~/schemas/params.schema";

/** The network's default action and access rules. */
export const getForNetwork = factory.createHandlers(
  requireOrganization,
  requirePermission({ network: ["read"] }),
  validate("param", networkIdParams),
  async (c) => {
    const acl = await c.var.services.acl.get(c.var.organizationId, c.req.valid("param").networkId);
    return c.json(acl, 200);
  },
);

/** Switches between "every device reaches every other" and "only what rules allow". */
export const updateForNetwork = factory.createHandlers(
  requireOrganization,
  requirePermission({ network: ["update"] }),
  validate("param", networkIdParams),
  validate("json", updateAclBody),
  async (c) => {
    const acl = await c.var.services.acl.setDefaultAction(
      c.var.organizationId,
      c.req.valid("param").networkId,
      c.req.valid("json").defaultAction,
    );
    return c.json(acl, 200);
  },
);

export const createRule = factory.createHandlers(
  requireOrganization,
  requirePermission({ network: ["update"] }),
  validate("param", networkIdParams),
  validate("json", createAclRuleBody),
  async (c) => {
    const rule = await c.var.services.acl.createRule(
      c.var.organizationId,
      c.req.valid("param").networkId,
      c.req.valid("json"),
    );
    return c.json(rule, 201);
  },
);

export const removeRule = factory.createHandlers(
  requireOrganization,
  requirePermission({ network: ["update"] }),
  validate("param", idParams),
  async (c) => {
    await c.var.services.acl.removeRule(c.var.organizationId, c.req.valid("param").id);
    return c.body(null, 204);
  },
);

/** The policy as a readable document (names and emails instead of ids). */
export const document = factory.createHandlers(
  requireOrganization,
  requirePermission({ network: ["read"] }),
  validate("param", networkIdParams),
  async (c) => {
    const doc = await c.var.services.acl.document(
      c.var.organizationId,
      c.req.valid("param").networkId,
    );
    return c.json(doc, 200);
  },
);

/** May one device connect to another on a protocol and port? And by which rule? */
export const check = factory.createHandlers(
  requireOrganization,
  requirePermission({ network: ["read"] }),
  validate("param", networkIdParams),
  validate("json", checkAccessBody),
  async (c) => {
    const result = await c.var.services.acl.check(
      c.var.organizationId,
      c.req.valid("param").networkId,
      c.req.valid("json"),
    );
    return c.json(result, 200);
  },
);
