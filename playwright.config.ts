import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke tests run against the Lovable preview URL by default.
 * Override with PLAYWRIGHT_BASE_URL to target a local dev server or
 * a different deployment.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }], ["junit", { outputFile: "reports/playwright-junit.xml" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ??
      "https://id-preview--ee4701f8-5b87-4cdd-bb72-abb7f87a3c82.lovable.app",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile",   use: { ...devices["Pixel 7"] } },
  ],
});
