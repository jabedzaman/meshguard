import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "@mesh/db";

// Human identity only. Devices authenticate with their own key pairs.
export function createAuth(db: Db, options: { secret: string; baseURL: string }) {
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    database: drizzleAdapter(db, { provider: "pg" }),
    emailAndPassword: { enabled: true },
  });
}

export type Auth = ReturnType<typeof createAuth>;
