import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { and, eq, schema, type Db } from "@mesh/db";
import type { AppEnv } from "~/env";
import { requireAuth } from "~/middleware/auth";

const idParam = z.object({
  id: z.uuid(),
});

// Columns exposed by the API. Response types are inferred from these, so the
// client never sees fields that aren't listed here.
const networkColumns = {
  id: schema.networks.id,
  organizationId: schema.networks.organizationId,
  name: schema.networks.name,
  ipv4Cidr: schema.networks.ipv4Cidr,
  ipv6Cidr: schema.networks.ipv6Cidr,
};

// Networks are scoped to the session's active organization. Better Auth only
// sets activeOrganizationId for organizations the user is a member of.
export function networksRoutes(db: Db) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", async (c) => {
      const organizationId = c.var.session.activeOrganizationId;
      if (!organizationId) return c.json({ error: "no_active_organization" }, 400);

      const rows = await db
        .select(networkColumns)
        .from(schema.networks)
        .where(eq(schema.networks.organizationId, organizationId));
      return c.json(rows, 200);
    })
    .get("/:id", zValidator("param", idParam), async (c) => {
      const organizationId = c.var.session.activeOrganizationId;
      if (!organizationId) return c.json({ error: "no_active_organization" }, 400);

      const { id } = c.req.valid("param");
      const [row] = await db
        .select(networkColumns)
        .from(schema.networks)
        .where(and(eq(schema.networks.id, id), eq(schema.networks.organizationId, organizationId)));
      if (!row) return c.json({ error: "network_not_found" }, 404);
      return c.json(row, 200);
    });
}
