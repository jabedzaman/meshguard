import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "~/schema";

export function createDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema });
}

export type Db = ReturnType<typeof createDb>;

/** Applies drizzle-kit migrations from `migrationsFolder` (used by the production image). */
export async function runMigrations(databaseUrl: string, migrationsFolder: string) {
  const db = drizzle(databaseUrl);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await db.$client.end();
  }
}
export { schema };

// Re-exported so apps use the same drizzle-orm instance as the schema;
// importing drizzle-orm directly can resolve a different peer-dep copy.
export * from "drizzle-orm";
