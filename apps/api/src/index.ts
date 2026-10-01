import { serve } from "@hono/node-server";
import { loadServerEnv } from "@mesh/config";
import { buildServer } from "~/server";

const env = loadServerEnv();
const app = buildServer();

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.API_PORT }, (info) => {
  console.log(`api listening on :${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
