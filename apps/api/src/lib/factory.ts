import { createFactory } from "hono/factory";
import type { AppEnv } from "~/types";

/**
 * Controllers are built with factory.createHandlers() so path params,
 * validated input and responses stay typed for the RPC client.
 */
export const factory = createFactory<AppEnv>();
