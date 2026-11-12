import { expect, test } from "@playwright/test";
import { AUTH_STATE, freshSession } from "../auth";
import { removeStudioTable } from "./test-helpers";

// Signed in by globalSetup, once for the suite. See e2e/auth.ts.
test.use({ storageState: AUTH_STATE });
test.beforeEach(({ context }) => freshSession(context));

test.describe("Property Type Gates E2E", () => {
  // The schema editor writes app/backend/schema/e_2_e_property_gate_test.ts and an index line;
  // the test cancels before that, but a failure midway must not leave a table
  // behind in the checkout for the next `db push` to create.
  test.afterAll(() => removeStudioTable("e_2_e_property_gate_test"));

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
    // Already signed in via storageState; the sidebar means the session is live.
    await expect(page.getByRole("link").filter({ hasText: "Orders" }).first()).toBeVisible({ timeout: 30000 });
  });

  test("property widget selector - gates types by engine", async ({ page }) => {
    // 1. Navigate to the schema editor
    await page.goto("/schema");
    await expect(page.getByText("Select a collection or create a new one to start editing")).toBeVisible({ timeout: 15000 });

    // 2. Create a new collection from scratch
    await page.getByRole("button", { name: "Add new collection" }).first().click();
    await expect(page.getByText("New collection", { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Continue from scratch" }).click();

    // 3. Fill in the name
    const nameInput = page.getByLabel("Name", { exact: true });
    await expect(nameInput).toBeVisible();
    await page.waitForTimeout(500); // Wait for transitions/animations to finish
    await nameInput.fill("E2E Property Gate Test");
    await expect(nameInput).toHaveValue("E2E Property Gate Test", { timeout: 5000 });

    // 4. Click Next to go to Properties tab
    const nextButton = page.getByRole("button", { name: "Next" });
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    // 5. Click 'Add new property' to open the property widget selector
    const addPropertyButton = page.getByRole("button", { name: "Add new property" }).first();
    await expect(addPropertyButton).toBeVisible();
    await addPropertyButton.click();

    // Verify the widget selector dialog opened
    await expect(page.getByText("Select a property widget", { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // 6. A table's columns are the col.* types: a document reference (a
    // Firestore path) is none of them, so the picker offers neither reference
    // widget on a Postgres table — a table points at another with a relation.
    await expect(page.getByText("Reference (as string)")).not.toBeVisible();
    await expect(page.getByRole("button", { name: /Reference The value refers to/i })).toHaveCount(0);

    // 7. 'Relation' IS available — the default engine is Postgres — and opens
    // the relation editor with its target picker.
    const relationOption = page.getByRole("button", { name: /^Relation\b/i }).first();
    await expect(relationOption).toBeVisible({ timeout: 5000 });
    await relationOption.click();
    await expect(page.getByPlaceholder("Field name")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Target collection").first()).toBeVisible({ timeout: 10000 });

    const propertyTitleInput = page.getByPlaceholder("Field name");
    await page.waitForTimeout(500); // Wait for dialog animations & hydration
    await propertyTitleInput.fill("Test Relation");
    await expect(propertyTitleInput).toHaveValue("Test Relation", { timeout: 5000 });

    const idInput = page.getByLabel("ID", { exact: true });
    await expect(idInput).toBeVisible();
    await page.waitForTimeout(200);
    await idInput.fill("test_relation");
    await expect(idInput).toHaveValue("test_relation", { timeout: 5000 });

    // Point it at an existing table, so validation passes on the relation half.
    const targetSelect = page.getByRole("combobox", { name: "Target collection" });
    await expect(targetSelect).toBeVisible();
    await targetSelect.click();
    const usersOption = page.getByRole("option", { name: "USERS" }).first();
    await expect(usersOption).toBeVisible();
    await usersOption.click();

    // A belongsTo names the foreign-key column on this table.
    const localKey = page.getByLabel("Local key (foreign key column on this table)");
    if (await localKey.isVisible()) {
      await localKey.fill("user_id");
    }

    await page.waitForTimeout(500); // Wait for deferred state updates

    // 8. Click Ok to add the relation property
    const okButton = page.getByRole("button", { name: "Ok" }).first();
    await expect(okButton).toBeVisible();
    await okButton.click();

    // Verify the property appears in the property list
    await expect(page.getByText("Test Relation", { exact: true })).toBeVisible({ timeout: 10000 });

    // 9. Open the picker again: the gate holds on every open, not just the first.
    await addPropertyButton.click();
    await expect(page.getByText("Select a property widget", { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // 10. Still no reference widget, and Relation still offered.
    await expect(page.getByRole("button", { name: /Reference The value refers to/i })).toHaveCount(0);
    await expect(page.getByText("Relation", { exact: true }).first()).toBeVisible({ timeout: 5000 });

    // 11. Close the dialog / cancel — no need to actually save the collection
    const cancelButton = page.getByRole("button", { name: "Cancel" }).first();
    if (await cancelButton.isVisible()) {
      await cancelButton.click();
    } else {
      await page.keyboard.press("Escape");
    }
  });
});
