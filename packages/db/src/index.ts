import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "~/schema";

export function createDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
