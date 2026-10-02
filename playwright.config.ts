import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./tests/e2e/support/env";

// Runs against the isolated e2e stack (`pnpm e2e:up`): web on :3200, API on
// :4200, database meshguard_test. The browser runs in the meshguard-playwright container
// unless E2E_LOCAL_BROWSER=1 (needs `npx playwright install --with-deps chromium`).
const useDockerBrowser = process.env.E2E_LOCAL_BROWSER !== "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/support/global-setup.ts",
  use: {
    baseURL: E2E.webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    ...(useDockerBrowser && { connectOptions: { wsEndpoint: E2E.browserWsEndpoint } }),
  },
});
