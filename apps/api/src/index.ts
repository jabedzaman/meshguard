import { serve } from "@hono/node-server";
import { createAuth } from "@mesh/auth";
import { loadServerEnv } from "@mesh/config";
import { createDb } from "@mesh/db";
import { createApp } from "~/app";

const env = loadServerEnv();
const db = createDb(env.DATABASE_URL);
const auth = createAuth(db, {
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.WEB_URL],
  github:
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : undefined,
});
const app = createApp({ db, auth, corsOrigins: [env.WEB_URL] });

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.API_PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
