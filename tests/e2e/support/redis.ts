import { Redis } from "ioredis";
import { E2E } from "./env";

/** Runs a Redis command against the e2e database. Only for test setup and assertions. */
export async function redis<T>(run: (client: Redis) => Promise<T>): Promise<T> {
  const client = new Redis(E2E.redisUrl);
  try {
    return await run(client);
  } finally {
    client.disconnect();
  }
}
