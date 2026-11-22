import { test, expect } from "@playwright/test";
import { openEmailForm } from "../auth";

test("App loads and shows login view", async ({ page }) => {
  await page.goto("/");

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Rebase/);

  // The login view: the email form itself, or the button in front of it when
  // the backend offers another way in.
  const loginView = page.locator('input[type="password"]')
    .or(page.getByRole("button", { name: /Sign in with email/i }));
  await expect(loginView.first()).toBeVisible({ timeout: 10000 });
});

test("Can click through to sign in (mock)", async ({ page }) => {
  await page.goto("/");

  // Accept privacy policy
  // The privacy checkbox, which is what gates the sign-in button.
  // `getByRole("checkbox")` was unambiguous until the newsletter opt-in moved
  // onto this screen — it now resolves to two elements and Playwright's strict
  // mode refuses. Privacy comes from the host's `topComponent`, which renders
  // above the newsletter row, so it is the first one.
  await page.getByRole("checkbox").first().check();

  await openEmailForm(page);

  // Wait for login form
  const emailInput = page.getByPlaceholder(/you@example.com/i);
  await expect(emailInput).toBeVisible();

  // Verify inputs are there
  const passwordInput = page.locator('input[type="password"]');
  await expect(passwordInput).toBeVisible();
});
