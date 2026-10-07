import { serve } from "@hono/node-server";
import { authOptionsFromEnv, createAuth } from "@meshguard/auth";
import { loadServerEnv } from "@meshguard/config";
import { createDb } from "@meshguard/db";
import {
  createEmailQueue,
  createNats,
  createRedis,
  createServices,
  DeviceEvents,
} from "@meshguard/server-core";
import { createApp } from "~/app";
import { logger } from "~/lib/logger";

const env = loadServerEnv();
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const emailQueue = createEmailQueue(redis);
const nats = await createNats(env.NATS_URL, "meshguard-api");
const services = createServices(
  { db, redis, deviceEvents: new DeviceEvents(nats) },
  {
    relayUrl: env.RELAY_URL,
    relayTokenKey: env.RELAY_TOKEN_KEY,
    stunServers: env.STUN_SERVERS,
    dnsBaseDomain: env.DNS_BASE_DOMAIN,
    webUrl: env.WEB_URL,
  },
);
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
  // A member's devices go with them.
  onMemberRemoved: async ({ userId, organizationId }) => {
    const removed = await services.devices.removeOwnedBy(organizationId, userId);
    if (removed.length > 0) {
      logger.info(
        { userId, organizationId, devices: removed.length },
        "removed a leaver's devices",
      );
    }
  },
  // Rules naming roles may now match other devices.
  onMemberRoleChanged: ({ organizationId }) => services.acl.membershipChanged(organizationId),
});
const app = createApp({ services, auth, corsOrigins: [env.WEB_URL] });

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
