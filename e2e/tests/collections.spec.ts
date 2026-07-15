import { test, expect } from "@playwright/test";
import { AUTH_STATE } from "../auth";

// Signed in by globalSetup, once for the suite. See e2e/auth.ts.
test.use({ storageState: AUTH_STATE });

test.describe("Collections Navigation", () => {
  test.beforeEach(async ({ page }) => {
    // Fail on any console error
    page.on("console", msg => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (text.includes("ERR_CONNECTION_REFUSED") || text.includes("Failed to load resource") || text.includes("WebSocket error")) {
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

    await page.goto("/");
    // Already signed in via storageState; the sidebar is the "session is live
    // and collections have loaded" signal these tests navigate from.
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
