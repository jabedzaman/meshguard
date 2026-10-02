import http from "node:http";
import { loadWorkerEnv } from "@mesh/config";
import { createMailer, createRedis } from "@mesh/server-core";
import { logger } from "~/lib/logger";
import { startWorkers } from "~/workers";

const env = loadWorkerEnv();
const redis = createRedis(env.REDIS_URL);
const mailer = createMailer({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM });
const workers = startWorkers({ redis, mailer });

const health = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const ok = redis.status === "ready";
    res
      .writeHead(ok ? 200 : 503, { "Content-Type": "application/json" })
      .end(JSON.stringify({ status: ok ? "ok" : "redis_unavailable" }));
    return;
  }
  res.writeHead(404).end();
});
health.listen(env.WORKER_HEALTH_PORT, () => {
  logger.info(
    { port: env.WORKER_HEALTH_PORT, workers: workers.workers.map((w) => w.name) },
    "workers started",
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, "shutting down");
    health.close();
    await workers.close();
    redis.disconnect();
    process.exit(0);
  });
}
