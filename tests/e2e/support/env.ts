export const E2E = {
  webUrl: process.env.E2E_WEB_URL ?? "http://localhost:3200",
  apiUrl: process.env.E2E_API_URL ?? "http://localhost:4200",
  mailpitUrl: process.env.E2E_MAILPIT_URL ?? "http://localhost:8025",
  redisUrl: process.env.E2E_REDIS_URL ?? "redis://localhost:6379/1",
  databaseUrl:
    process.env.E2E_DATABASE_URL ?? "postgres://meshguard:meshguard@localhost:5432/meshguard_test",
  browserWsEndpoint: process.env.PLAYWRIGHT_WS_ENDPOINT ?? "ws://127.0.0.1:3300/",
};
