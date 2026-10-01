import { Hono } from "hono";
import { logger } from "hono/logger";

export function buildServer() {
  const app = new Hono();

  app.use(logger());
  app.get("/healthz", (c) => c.json({ ok: true }));

  return app;
}

export type AppType = ReturnType<typeof buildServer>;
