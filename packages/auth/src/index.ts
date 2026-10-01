import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import type { AuthEnv } from "@mesh/config";
import { asc, eq, schema, type Db } from "@mesh/db";

export interface AuthOptions {
  secret: string;
  /** Public URL of the API that serves /api/auth. */
  baseURL: string;
  /** Origins allowed to call the auth endpoints with cookies, e.g. the web dashboard. */
  trustedOrigins: string[];
  github?: { clientId: string; clientSecret: string };
}

export function authOptionsFromEnv(env: AuthEnv): AuthOptions {
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_URL],
    github:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
        : undefined,
  };
}

// Human identity only. Devices authenticate with their own key pairs.
export function createAuth(db: Db, options: AuthOptions) {
  return betterAuth({
    appName: "Mesh",
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: "/api/auth",
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    socialProviders: options.github ? { github: options.github } : {},
    plugins: [organization()],
    databaseHooks: {
      session: {
        create: {
          // New sessions start without an active organization; default to the
          // user's oldest membership so returning users land in their org.
          before: async (session) => {
            const [membership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .orderBy(asc(schema.member.createdAt))
              .limit(1);
            return { data: { ...session, activeOrganizationId: membership?.organizationId ?? null } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"]["session"];
export type User = Auth["$Infer"]["Session"]["user"];
