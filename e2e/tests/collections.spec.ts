import { test, expect } from "@playwright/test";

test.describe("Collections Navigation", () => {
  test.beforeEach(async ({ page }) => {
    // Fail on any console error
    page.on("console", msg => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (text.includes("ERR_CONNECTION_REFUSED") || text.includes("Failed to load resource")) {
          return;
        }
        throw new Error(`Console error: ${text}`);
      }
    });

    // Fail on any failed API request
    page.on("response", response => {
      if (response.url().includes("/api/") && response.status() >= 400) {
        throw new Error(`API Request failed: ${response.url()} returned status ${response.status()}`);
      }
    });

    // Perform standard demo login
    await page.goto("/");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Sign in with email/i }).click();
    const signInButton = page.locator("button", { hasText: /^Sign in$/i }).first();
    await expect(signInButton).toBeVisible();
    await Promise.all([
      signInButton.click(),
      page.waitForResponse(resp => resp.url().includes("/api/") && resp.status() !== 204, { timeout: 10000 }).catch(() => {})
    ]);
    // Wait for the Orders link in the sidebar to appear, ensuring we are logged in
    await expect(page.getByRole("link").filter({ hasText: "Orders" }).first()).toBeVisible({ timeout: 30000 });
  });

  test("can navigate to Orders collection and view data", async ({ page }) => {
    // Click on 'Orders' in the sidebar
    await page.getByRole("link").filter({ hasText: "Orders" }).first().click();

    // Verify the URL changes to /c/orders
    await expect(page).toHaveURL(/\/c\/orders/);

    // Verify the table loads (look for an Add button)
    const addButton = page.getByRole("button", { name: /Add/i }).first();
    await expect(addButton).toBeVisible({ timeout: 10000 });
  });

  test("can navigate to Products collection and view data", async ({ page }) => {
    // Click on 'Products' in the sidebar
    await page.getByRole("link").filter({ hasText: "Products" }).first().click();

    await expect(page).toHaveURL(/\/c\/products/);

    const addButton = page.getByRole("button", { name: /Add/i }).first();
    await expect(addButton).toBeVisible({ timeout: 10000 });
  });

  test("can navigate to Customers collection and view data", async ({ page }) => {
    await page.getByRole("link").filter({ hasText: "Customers" }).first().click();
    await expect(page).toHaveURL(/\/c\/customers/);
    const addButton = page.getByRole("button", { name: /Add/i }).first();
    await expect(addButton).toBeVisible({ timeout: 10000 });
  });

  test("can navigate to Tickets collection and view data", async ({ page }) => {
    await page.getByRole("link").filter({ hasText: "Tickets" }).first().click();
    await expect(page).toHaveURL(/\/c\/tickets/);
    const addButton = page.getByRole("button", { name: /Add/i }).first();
    await expect(addButton).toBeVisible({ timeout: 10000 });
  });
});
