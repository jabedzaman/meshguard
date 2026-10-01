import { serve } from "@hono/node-server";
import { authOptionsFromEnv, createAuth } from "@mesh/auth";
import { loadServerEnv } from "@mesh/config";
import { createDb } from "@mesh/db";
import { createApp } from "~/app";
import { logger } from "~/lib/logger";

const env = loadServerEnv();
const db = createDb(env.DATABASE_URL);
const auth = createAuth(db, authOptionsFromEnv(env));
const app = createApp({ db, auth, corsOrigins: [env.WEB_URL] });

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.API_PORT }, (info) => {
  logger.info({ port: info.port }, "api listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}
