import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { eq, schema, type Db } from "@mesh/db";
import type { Network } from "@mesh/types";

const listQuery = z.object({
  organizationId: z.uuid(),
});

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

// TODO: scope to the caller's organization once Better Auth sessions are wired in.
export function networksRoutes(db: Db) {
  return new Hono()
    .get("/", zValidator("query", listQuery), async (c) => {
      const { organizationId } = c.req.valid("query");
      const rows = await db
        .select()
        .from(schema.networks)
        .where(eq(schema.networks.organizationId, organizationId));
      return c.json(rows.map(toNetwork), 200);
    })
    .get("/:id", zValidator("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const [row] = await db.select().from(schema.networks).where(eq(schema.networks.id, id));
      if (!row) return c.json({ error: "network_not_found" }, 404);
      return c.json(toNetwork(row), 200);
    });
}
