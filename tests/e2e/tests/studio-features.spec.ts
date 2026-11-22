import { expect, test } from "@playwright/test";
import { AUTH_STATE, freshSession } from "../auth";

// Signed in by globalSetup, once for the suite. See e2e/auth.ts.
test.use({ storageState: AUTH_STATE });
test.beforeEach(({ context }) => freshSession(context));

test.describe("Rebase Studio Features E2E", () => {
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

    // Fail on any failed API request — carrying the body, not just the status.
    //
    // This server answers `{error:{code,message}}` on every refusal, and the
    // message is written for whoever has to act on it. Throwing the status
    // alone discards exactly that: "returned status 500" is indistinguishable
    // between a missing dependency, a refused commit and a real crash, and the
    // server's own log is not always in the CI artifact to fall back on.
    page.on("response", response => {
      if (!response.url().includes("/api/") || response.status() < 400) return;
      // `void`: the handler cannot be async — Playwright does not await it —
      // so the body is read on its own and thrown from there.
      void response.text().then(
        body => {
          throw new Error(
            `API Request failed: ${response.url()} returned status ${response.status()}` +
            `\n  body: ${body.slice(0, 600)}`
          );
        },
        () => {
          throw new Error(
            `API Request failed: ${response.url()} returned status ${response.status()} ` +
            "(body unavailable)"
          );
        }
      );
    });

    await page.goto("/");
    // Already signed in via storageState; the sidebar means the session is live.
    await expect(page.getByRole("link").filter({ hasText: "Orders" }).first()).toBeVisible({ timeout: 30000 });
  });

  test("sql console - can run queries, handle syntax errors, and switch roles", async ({ page }) => {
    // Navigate to SQL Console
    await page.goto("/sql");

    // Wait for results placeholder or schema tree to render
    await expect(page.getByText("Run a query to see results")).toBeVisible({ timeout: 15000 });

    // Input simple query: SELECT 1 as test_val;
    const editor = page.locator(".monaco-editor").first();
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("Meta+KeyA"); // Select all (Mac)
    await page.keyboard.press("Control+KeyA"); // Select all (Linux/Windows fallback)
    await page.keyboard.press("Delete");
    await page.keyboard.insertText("SELECT 1 as test_val;");

    // Click the "Run" button
    const runButton = page.getByRole("button", { name: "Run" }).first();
    await expect(runButton).toBeEnabled();
    await runButton.click();

    // Verify output renders results (e.g. table header "test_val" and cell value "1")
    await expect(page.getByText("test_val").first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("1", { exact: true }).first()).toBeVisible();

    // Test syntax error clean handling: SELECT * FROM table_does_not_exist_xyz;
    await editor.click();
    await page.keyboard.press("Meta+KeyA");
    await page.keyboard.press("Control+KeyA");
    await page.keyboard.press("Delete");
    await page.keyboard.insertText("SELECT * FROM table_does_not_exist_xyz;");
    await runButton.click();

    // Verify it doesn't crash the server or WebSocket, but renders a query error box in the UI
    await expect(page.getByText("Query Error")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('relation "table_does_not_exist_xyz" does not exist')).toBeVisible();

    // Test Role Switching in the toolbar selector
    // Click on the Database selection button which also shows the role
    const dbSelector = page.locator('button:has-text("rebase")').first();
    await expect(dbSelector).toBeVisible();
    await dbSelector.click();

    // We should see menu items for roles
    const roleItem = page.locator('[role="menuitem"]:has-text("rebase")').first();
    await expect(roleItem).toBeVisible();
    await roleItem.click();
  });
});
