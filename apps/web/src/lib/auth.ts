import "server-only";
import { type Auth, authOptionsFromEnv, createAuth } from "@mesh/auth";
import { loadAuthEnv } from "@mesh/config";
import { createDb, type Db } from "@mesh/db";

// Server-side Better Auth instance and database, shared with the API, so the
// proxy, layouts and server components can read sessions directly.
//
// Created on first use rather than at import: `next build` imports layouts to
// read their config, and the database env isn't available at build time.
let instance: { auth: Auth; db: Db } | undefined;

function getInstance() {
  if (!instance) {
    const env = loadAuthEnv();
    const db = createDb(env.DATABASE_URL);
    instance = { db, auth: createAuth(db, authOptionsFromEnv(env)) };
  }
  return instance;
}

export const auth = new Proxy({} as Auth, {
  get: (_, property) => Reflect.get(getInstance().auth, property),
});

export function getDb(): Db {
  return getInstance().db;
}
