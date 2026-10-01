import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { and, eq, schema, type Db } from "@mesh/db";
import type { Network } from "@mesh/types";
import type { AppEnv } from "~/env";
import { requireAuth } from "~/middleware/auth";

const idParam = z.object({
  id: z.uuid(),
});

// Map DB rows to API types so Drizzle internals never leak into the client's types.
function toNetwork(row: typeof schema.networks.$inferSelect): Network {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    ipv4Cidr: row.ipv4Cidr,
    ipv6Cidr: row.ipv6Cidr,
  };
}

// Networks are scoped to the session's active organization. Better Auth only
// sets activeOrganizationId for organizations the user is a member of.
export function networksRoutes(db: Db) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .get("/", async (c) => {
      const organizationId = c.var.session.activeOrganizationId;
      if (!organizationId) return c.json({ error: "no_active_organization" }, 400);

      const rows = await db
        .select()
        .from(schema.networks)
        .where(eq(schema.networks.organizationId, organizationId));
      return c.json(rows.map(toNetwork), 200);
    })
    .get("/:id", zValidator("param", idParam), async (c) => {
      const organizationId = c.var.session.activeOrganizationId;
      if (!organizationId) return c.json({ error: "no_active_organization" }, 400);

      const { id } = c.req.valid("param");
      const [row] = await db
        .select()
        .from(schema.networks)
        .where(and(eq(schema.networks.id, id), eq(schema.networks.organizationId, organizationId)));
      if (!row) return c.json({ error: "network_not_found" }, 404);
      return c.json(toNetwork(row), 200);
    });
}
