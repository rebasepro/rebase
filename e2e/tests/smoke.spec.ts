import { test, expect } from "@playwright/test";

test("App loads and shows login view", async ({ page }) => {
  await page.goto("/");

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Rebase/);

  // Check if we are at the login view by searching for the sign in button
  const signInBtn = page.getByRole("button", { name: /Sign in with email/i });
  await expect(signInBtn).toBeVisible({ timeout: 10000 });
});

test("Can click through to sign in (mock)", async ({ page }) => {
  await page.goto("/");

  // Accept privacy policy
  await page.getByRole("checkbox").check();

  // Click sign in button
  await page.getByRole("button", { name: /Sign in with email/i }).click();

  // Wait for login form
  const emailInput = page.getByPlaceholder(/you@example.com/i);
  await expect(emailInput).toBeVisible();

  // Verify inputs are there
  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible();
});
