import { expect, test } from "@playwright/test";
import { AUTH_STATE } from "../auth";
import * as fs from "fs";
import * as path from "path";

// Signed in by globalSetup, once for the suite. See e2e/auth.ts.
test.use({ storageState: AUTH_STATE });

test.describe("Rebase Studio Features E2E", () => {
  test.afterAll(async () => {
    const filePath = path.resolve(__dirname, "../../../app/config/collections/e_2_e_test_collection.ts");
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Failed to clean up E2E collection file:", err);
      }
    }
  });

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

  test("visual collection editor - builds a collection and previews the schema change", async ({ page }) => {
    // Go directly to the schema editing page
    await page.goto("/schema");

    // Check that we see the page title or welcoming instructions
    await expect(page.getByText("Select a collection or create a new one to start editing")).toBeVisible({ timeout: 15000 });

    // Click on "Add new collection" button
    await page.getByRole("button", { name: "Add new collection" }).first().click();

    // Verify we are at the welcome view
    await expect(page.getByText("New collection", { exact: true })).toBeVisible({ timeout: 10000 });

    // Click "Continue from scratch"
    await page.getByRole("button", { name: "Continue from scratch" }).click();

    // Now on the General settings tab
    const nameInput = page.getByLabel("Name", { exact: true });
    await expect(nameInput).toBeVisible();
    await page.waitForTimeout(500); // Wait for transitions/animations to finish
    await nameInput.click({ force: true });
    await nameInput.fill("");
    await nameInput.pressSequentially("E2E Test Collection", { delay: 50 });
    await expect(nameInput).toHaveValue("E2E Test Collection", { timeout: 5000 });

    // Verify the Next button is enabled and click it
    const nextButton = page.getByRole("button", { name: "Next" });
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    // Now on the Properties tab
    // Click "Add new property" button
    const addPropertyButton = page.getByRole("button", { name: "Add new property" }).first();
    await expect(addPropertyButton).toBeVisible();
    await addPropertyButton.click();

    // Verify the "Select a property widget" dialog opened
    await expect(page.getByText("Select a property widget", { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // Select "Text field" card option in the widget dialog
    await page.getByText("Text field", { exact: true }).first().click();

    // Wait for the specific property settings to render to ensure Formex state is hydrated
    await expect(page.getByText("Database Column Type")).toBeVisible({ timeout: 10000 });

    // Fill property details (Title of property field using its placeholder)
    const propertyTitleInput = page.getByPlaceholder("Field name");
    await expect(propertyTitleInput).toBeVisible();
    await page.waitForTimeout(500); // Wait for dialog animations & hydration
    await propertyTitleInput.click({ force: true });
    await propertyTitleInput.fill("");
    await propertyTitleInput.pressSequentially("Post Title", { delay: 50 });
    await expect(propertyTitleInput).toHaveValue("Post Title", { timeout: 5000 });

    // Fill ID field explicitly to ensure it has a valid value without relying on auto-update timing
    const idInput = page.getByLabel("ID", { exact: true });
    await expect(idInput).toBeVisible();
    await page.waitForTimeout(200);
    await idInput.click({ force: true });
    await idInput.fill("");
    await idInput.pressSequentially("post_title", { delay: 50 });
    await expect(idInput).toHaveValue("post_title", { timeout: 5000 });

    // Wait a brief moment for the deferred state updates to propagate to Formex
    await page.waitForTimeout(500);

    // Click Ok to save the property
    const okButton = page.getByRole("button", { name: "Ok" }).first();
    await expect(okButton).toBeVisible();
    await okButton.click();

    // Check that the property tree list now contains "Post Title"
    await expect(page.getByText("Post Title", { exact: true })).toBeVisible({ timeout: 10000 });

    // Click "Create collection" to persist it
    const createButton = page.getByRole("button", { name: "Create collection" });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    // Saving no longer writes straight through. A backend that can edit its own
    // schema plans the change first and shows what it would do — the verdict,
    // the SQL, the files it would commit — and nothing happens until somebody
    // agrees.
    //
    // This test stops at the preview and cancels, deliberately. Confirming runs
    // a real `git commit` into whatever repository the app is served from —
    // which for `rebase dev` in `app/` is **this checkout**, so a developer
    // running the suite locally would get generated files committed onto their
    // current branch. The apply half is covered where it can be done safely:
    // `packages/server-postgres/test/e2e/live-schema-editing-e2e.test.ts`
    // drives it against a real Postgres and a repository it creates under
    // `mkdtemp`.
    //
    // A backend that *cannot* edit its schema — a bundle deployment, a
    // non-Postgres driver — shows no dialog and the save completes on its own,
    // so this waits for whichever of the two this deployment is.
    const review = page.getByText("Review schema change");
    const savedOutright = page.waitForURL(/.*schema\/e_2_e_test_collection/, { timeout: 25000 })
        .then(() => "saved" as const, () => undefined);

    const outcome = await Promise.race([
        review.waitFor({ state: "visible", timeout: 25000 }).then(() => "reviewed" as const),
        savedOutright
    ]);

    if (outcome === "reviewed") {
        // The preview is the product here: it has to name what it would do,
        // not merely appear.
        // The verdict line differs between a change that runs DDL and one that
        // only commits, so this asserts the *evidence* rather than the wording:
        // the preview has to name what it would do, whichever engine is behind
        // it. Postgres reaches here with statements; MongoDB would not.
        await expect(page.getByText("Files that will be committed", { exact: false })).toBeVisible();
        await expect(page.getByText("Commit message", { exact: false })).toBeVisible();

        await page.getByRole("button", { name: "Cancel" }).click();

        // Cancelling is an answer, not a no-op: the dialog closes and the
        // editor stays where it was, with nothing written.
        await expect(review).toBeHidden({ timeout: 10000 });
        await expect(page).toHaveURL(/.*schema\/new/);
    } else {
        // No live schema editing here, so the save went straight through.
        await expect(page).toHaveURL(/.*schema\/e_2_e_test_collection/, { timeout: 30000 });
    }
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
