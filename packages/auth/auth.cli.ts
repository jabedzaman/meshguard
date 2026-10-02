// Entry point for the Better Auth CLI only (`pnpm auth:generate`), which reads
// plugin schemas to generate packages/db/src/schema/auth.ts. Not used at runtime.
import { createDb } from "@meshguard/db";
import { createAuth } from "./src/index";

export const auth = createAuth(createDb("postgres://localhost/unused"), {
  secret: "cli",
  baseURL: "http://localhost:4000",
  trustedOrigins: [],
});
