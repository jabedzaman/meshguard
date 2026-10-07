import { serve } from "@hono/node-server";
import { authOptionsFromEnv, createAuth } from "@meshguard/auth";
import { loadServerEnv } from "@meshguard/config";
import { createDb } from "@meshguard/db";
import {
  challtestsrvDns,
  cloudflareDns,
  createEmailQueue,
  createNats,
  createRedis,
  createServices,
  DeviceEvents,
  trustAnyAcmeServer,
} from "@meshguard/server-core";
import { createApp } from "~/app";
import { logger } from "~/lib/logger";

const env = loadServerEnv();
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const emailQueue = createEmailQueue(redis);
const nats = await createNats(env.NATS_URL, "meshguard-api");
// A DNS provider for ACME and funnel records, if one is configured.
function dnsFromEnv() {
  if (
    env.ACME_DNS_PROVIDER === "cloudflare" &&
    env.CLOUDFLARE_API_TOKEN &&
    env.CLOUDFLARE_ZONE_ID
  ) {
    return cloudflareDns({ apiToken: env.CLOUDFLARE_API_TOKEN, zoneId: env.CLOUDFLARE_ZONE_ID });
  }
  if (env.ACME_DNS_PROVIDER === "challtestsrv" && env.CHALLTESTSRV_URL) {
    return challtestsrvDns({ url: env.CHALLTESTSRV_URL });
  }
  return undefined;
}

// HTTPS certificates for mesh names need an ACME directory and a way to answer DNS-01.
function certificatesFromEnv() {
  if (!env.ACME_DIRECTORY_URL) return undefined;
  const dns = dnsFromEnv();
  if (!dns) {
    logger.warn("ACME_DIRECTORY_URL is set without a DNS provider: certificates are off");
    return undefined;
  }
  if (env.ACME_INSECURE_TLS) trustAnyAcmeServer();
  return {
    directoryUrl: env.ACME_DIRECTORY_URL,
    email: env.ACME_EMAIL,
    dns,
    // The test DNS server isn't on the system resolver, so we can't look the record up first.
    skipChallengeVerification: env.ACME_DNS_PROVIDER === "challtestsrv",
  };
}

function funnelDnsFromEnv() {
  const dns = dnsFromEnv();
  return dns && env.FUNNEL_PUBLIC_IP ? { provider: dns, address: env.FUNNEL_PUBLIC_IP } : undefined;
}

const services = createServices(
  { db, redis, deviceEvents: new DeviceEvents(nats) },
  {
    relayUrl: env.RELAY_URL,
    relayTokenKey: env.RELAY_TOKEN_KEY,
    stunServers: env.STUN_SERVERS,
    dnsBaseDomain: env.DNS_BASE_DOMAIN,
    webUrl: env.WEB_URL,
    certificates: certificatesFromEnv(),
    funnelDns: funnelDnsFromEnv(),
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
