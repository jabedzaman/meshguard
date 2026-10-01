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
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
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
  GITHUB_CLIENT_ID: true,
  GITHUB_CLIENT_SECRET: true,
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export function loadAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  return authEnvSchema.parse(env);
}
