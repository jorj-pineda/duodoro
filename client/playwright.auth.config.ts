import { defineConfig } from "@playwright/test";
import { APP_ORIGIN, SOCKET_ORIGIN, localEnvironment } from "./e2e-auth/localEnvironment";

const local = localEnvironment();

export default defineConfig({
  testDir: "./e2e-auth",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 9 * 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/authenticated",
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report/authenticated" }]]
    : "list",
  use: {
    baseURL: APP_ORIGIN,
  },
  webServer: [
    {
      command: "npm run start --prefix ../server",
      url: `${SOCKET_ORIGIN}/ready`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        PORT: "3301",
        NODE_ENV: "development",
        ALLOWED_ORIGIN: APP_ORIGIN,
        SUPABASE_URL: local.url,
        SUPABASE_SERVICE_KEY: local.serviceKey,
        FOCUS_QUEUE_URL: "",
      },
    },
    {
      command: "npm run start -- -p 3300",
      url: APP_ORIGIN,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
