import pg from "pg";
import { E2E } from "./env";

/** Runs SQL against the e2e database. Only for test setup and assertions. */
export async function sql<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  try {
    return (await client.query<Row>(text, values)).rows;
  } finally {
    await client.end();
  }
}
