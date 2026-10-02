import { execSync } from "node:child_process";
import pg from "pg";
import { E2E } from "./env";

async function waitFor(url: string, name: string) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`${name} isn't reachable at ${url}. Start the e2e stack with \`pnpm e2e:up\`.`);
}

/** Fresh meshguard_test database, then wait for the e2e stack. */
export default async function globalSetup() {
  const testDb = new URL(E2E.databaseUrl);
  const dbName = testDb.pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to reset "${dbName}": the e2e database name must end in _test.`);
  }

  const admin = new pg.Client({ connectionString: new URL("/postgres", testDb).toString() });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
  if (exists.rowCount === 0) await admin.query(`create database "${dbName}"`);
  await admin.end();

  execSync("pnpm --filter @meshguard/db db:migrate", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: E2E.databaseUrl },
  });

  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length > 0) {
    await client.query(
      `truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`,
    );
  }
  await client.end();

  await waitFor(`${E2E.apiUrl}/healthz`, "e2e API");
  await waitFor(`${E2E.webUrl}/sign-in`, "e2e web");
}
