import { runMigrations } from "@meshguard/db";
import { logger } from "~/lib/logger";

// Production entry: applies the migrations bundled into the image at
// ./migrations. In development use `pnpm --filter @meshguard/db db:migrate`.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

await runMigrations(databaseUrl, process.env.MIGRATIONS_DIR ?? "migrations");
logger.info("migrations applied");
