import { serve } from "@hono/node-server";
import { authOptionsFromEnv, createAuth } from "@mesh/auth";
import { loadServerEnv } from "@mesh/config";
import { createDb } from "@mesh/db";
import { createApp } from "~/app";

const env = loadServerEnv();
const db = createDb(env.DATABASE_URL);
const auth = createAuth(db, authOptionsFromEnv(env));
const app = createApp({ db, auth, corsOrigins: [env.WEB_URL] });

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.API_PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
