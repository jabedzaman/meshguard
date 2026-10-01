import "server-only";
import { authOptionsFromEnv, createAuth } from "@mesh/auth";
import { loadAuthEnv } from "@mesh/config";
import { createDb } from "@mesh/db";

// Server-side Better Auth instance, sharing the API's database and config, so
// the proxy and server components can read sessions without calling the API.
const env = loadAuthEnv();

export const auth = createAuth(createDb(env.DATABASE_URL), authOptionsFromEnv(env));
