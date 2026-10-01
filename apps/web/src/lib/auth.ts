import "server-only";
import { type Auth, authOptionsFromEnv, createAuth } from "@mesh/auth";
import { loadAuthEnv } from "@mesh/config";
import { createDb } from "@mesh/db";

// Server-side Better Auth instance, sharing the API's database and config, so
// the proxy, layouts and server components can read sessions directly.
//
// Created on first use rather than at import: `next build` imports layouts to
// read their config, and the database env isn't available at build time.
let instance: Auth | undefined;

function getAuth(): Auth {
  if (!instance) {
    const env = loadAuthEnv();
    instance = createAuth(createDb(env.DATABASE_URL), authOptionsFromEnv(env));
  }
  return instance;
}

export const auth = new Proxy({} as Auth, {
  get: (_, property) => Reflect.get(getAuth(), property),
});
