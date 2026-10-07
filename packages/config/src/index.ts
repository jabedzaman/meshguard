import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => v || undefined);

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  NATS_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Public URL of the API, where /api/auth is served. */
  BETTER_AUTH_URL: z.url(),
  /** Public URL of the web dashboard; allowed to call the API with cookies. */
  WEB_URL: z.url(),
  /**
   * Parent domain for auth cookies when web and API are on different
   * subdomains, e.g. example.com for app.example.com + api.example.com.
   */
  AUTH_COOKIE_DOMAIN: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  /** Relay agents use when peers can't reach each other directly, e.g. wss://relay.example.com/relay. */
  RELAY_URL: optional.pipe(z.url().optional()),
  /**
   * Base64 Ed25519 seed that signs relay tokens, so the relay (RELAY_TRUST_KEY)
   * only serves enrolled devices. `meshguard-relay -gen-key` makes a pair.
   */
  RELAY_TOKEN_KEY: optional,
  /**
   * Domain devices resolve under: `<device>.<network label>.<DNS_BASE_DOMAIN>`.
   * Agents answer these names themselves; the domain only needs to be public
   * for HTTPS certificates. lvh.me publicly resolves every name to 127.0.0.1.
   */
  DNS_BASE_DOMAIN: optional.pipe(
    z
      .string()
      .regex(
        /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/,
        "a lowercase domain like mesh.example.com",
      )
      .default("lvh.me"),
  ),
  /** Comma-separated host:port STUN servers agents use to find their public address. */
  STUN_SERVERS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(env);
}

/** Subset needed to run Better Auth, e.g. in the web app's proxy. */
export const authEnvSchema = serverEnvSchema.pick({
  DATABASE_URL: true,
  BETTER_AUTH_SECRET: true,
  BETTER_AUTH_URL: true,
  WEB_URL: true,
  AUTH_COOKIE_DOMAIN: true,
  GITHUB_CLIENT_ID: true,
  GITHUB_CLIENT_SECRET: true,
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export function loadAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  return authEnvSchema.parse(env);
}

/** Environment for the workers app. */
export const workerEnvSchema = z.object({
  NODE_ENV: serverEnvSchema.shape.NODE_ENV,
  REDIS_URL: z.url(),
  NATS_URL: serverEnvSchema.shape.NATS_URL,
  /** e.g. smtp://mailpit:1025 in development. */
  SMTP_URL: z.url(),
  MAIL_FROM: z.string().min(1),
  /** Port for the /health endpoint. */
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(9091),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return workerEnvSchema.parse(env);
}
