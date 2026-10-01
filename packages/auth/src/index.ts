import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { schema, type Db } from "@mesh/db";

export interface AuthOptions {
  secret: string;
  /** Public URL of the API that serves /api/auth. */
  baseURL: string;
  /** Origins allowed to call the auth endpoints with cookies, e.g. the web dashboard. */
  trustedOrigins: string[];
  github?: { clientId: string; clientSecret: string };
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
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"]["session"];
export type User = Auth["$Infer"]["Session"]["user"];
