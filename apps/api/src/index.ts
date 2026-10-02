import { serve } from "@hono/node-server";
import { authOptionsFromEnv, createAuth } from "@mesh/auth";
import { loadServerEnv } from "@mesh/config";
import { createDb } from "@mesh/db";
import { createEmailQueue, createNats, createRedis, DeviceEvents } from "@mesh/server-core";
import { createApp } from "~/app";
import { logger } from "~/lib/logger";

const env = loadServerEnv();
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const emailQueue = createEmailQueue(redis);
const nats = await createNats(env.NATS_URL, "mesh-api");
const auth = createAuth(db, {
  ...authOptionsFromEnv(env),
  // Queued, not sent: the workers app renders and delivers every email.
  sendInvitationEmail: async (invitation) => {
    await emailQueue.enqueue("invitation", {
      to: invitation.email,
      props: {
        organizationName: invitation.organizationName,
        inviterName: invitation.inviterName,
        role: invitation.role,
        url: new URL(`/invitations/${invitation.id}`, env.WEB_URL).toString(),
      },
    });
  },
});
const app = createApp({
  db,
  redis,
  deviceEvents: new DeviceEvents(nats),
  auth,
  corsOrigins: [env.WEB_URL],
  relayUrl: env.RELAY_URL,
  stunServers: env.STUN_SERVERS,
});

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.API_PORT }, (info) => {
  logger.info({ port: info.port }, "api listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(async () => {
      await emailQueue.queue.close();
      redis.disconnect();
      process.exit(0);
    });
    // Ends open device event streams, which server.close waits for.
    void nats.drain();
  });
}
