import { z } from "zod";

/*
 * Shared path-param schemas, named after the route segment they validate
 * (`idParams` for "/:id", `networkIdParams` for "/:networkId").
 *
 * ID formats differ by owner:
 * - our tables (networks, devices, ...) use UUIDs
 * - Better Auth tables (users, organizations, members) use opaque string ids
 *
 * The organization id is intentionally not here: it always comes from the
 * session via requireOrganization (c.var.organizationId), never from the
 * request, so a caller can't address another organization's data.
 */

const uuid = z.uuid();
const betterAuthId = z.string().min(1).max(64);

/** "/:id" for resources in our own tables. */
export const idParams = z.object({ id: uuid });

/** "/:networkId" for routes nested under a network. */
export const networkIdParams = z.object({ networkId: uuid });

/** "/:userId" for Better Auth users. */
export const userIdParams = z.object({ userId: betterAuthId });
