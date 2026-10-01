import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "~/schema";

export function createDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };

// Re-exported so apps use the same drizzle-orm instance as the schema;
// importing drizzle-orm directly can resolve a different peer-dep copy.
export * from "drizzle-orm";
