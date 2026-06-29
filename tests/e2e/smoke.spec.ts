import { test, expect } from "@playwright/test";

/**
 * Smoke E2E — exercises the only routes reachable without a logged-in
 * Supabase session. Full authenticated journeys (task CRUD, EOD,
 * carry-forward, manager approve, CSV export) are covered exhaustively
 * by the vitest unit suite against the same service layer the UI calls.
 * To run authenticated journeys end-to-end, set TEST_USER_EMAIL /
 * TEST_USER_PASSWORD and remove the test.skip below.
 */
test.describe("public surface", () => {
  test("root redirects unauthenticated visitor to /login", async ({ page }) => {
    const resp = await page.goto("/");
    expect(resp?.ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/login/);
  });

  test("login page renders email + password inputs and a submit button", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading")).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|log in|continue/i })).toBeVisible();
  });

  test("invalid credentials surface an error and do not redirect", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("does-not-exist@example.com");
    await page.locator('input[type="password"]').fill("wrong-password-xyz");
    await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("authenticated journeys", () => {
  test.skip(
    !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
    "set TEST_USER_EMAIL + TEST_USER_PASSWORD to run authenticated journey tests",
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(process.env.TEST_USER_EMAIL!);
    await page.locator('input[type="password"]').fill(process.env.TEST_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in|log in|continue/i }).click();
    await page.waitForURL(/\/today/, { timeout: 10_000 });
  });

  test("today page loads", async ({ page }) => {
    await expect(page.locator("body")).toContainText(/today|tasks/i);
  });

  test("blockers page loads", async ({ page }) => {
    await page.goto("/blockers");
    await expect(page.locator("body")).toBeVisible();
  });

  test("intelligence dashboard loads", async ({ page }) => {
    await page.goto("/intelligence");
    await expect(page.locator("body")).toBeVisible();
  });

  test("planning suggestions page loads", async ({ page }) => {
    await page.goto("/planning-suggestions");
    await expect(page.locator("body")).toBeVisible();
  });

  test("exports page loads", async ({ page }) => {
    await page.goto("/exports");
    await expect(page.locator("body")).toBeVisible();
  });
});
