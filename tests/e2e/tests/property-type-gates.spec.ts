import { expect, test } from "@playwright/test";
import { AUTH_STATE } from "../auth";
import * as fs from "fs";
import * as path from "path";

// Signed in by globalSetup, once for the suite. See e2e/auth.ts.
test.use({ storageState: AUTH_STATE });

test.describe("Property Type Gates E2E", () => {
  test.afterAll(async () => {
    const filePath = path.resolve(__dirname, "../../../app/config/collections/e_2_e_property_gate_test.ts");
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

    // 6. Verify that 'Reference (as string)' is NOT in the widget list — it was removed
    await expect(page.getByText("Reference (as string)")).not.toBeVisible();

    // 7. Verify that 'Reference' IS available and click it
    const referenceOption = page.getByRole("button", { name: /Reference The value refers to/i }).first();
    await expect(referenceOption).toBeVisible({ timeout: 5000 });
    await referenceOption.click();

    // Verify the reference property editor appears (wait for property settings to render)
    await expect(page.getByPlaceholder("Field name")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Target collection").first()).toBeVisible({ timeout: 10000 });

    // Fill in the property name to ensure we can proceed
    const propertyTitleInput = page.getByPlaceholder("Field name");
    await page.waitForTimeout(500); // Wait for dialog animations & hydration
    await propertyTitleInput.fill("Test Reference");
    await expect(propertyTitleInput).toHaveValue("Test Reference", { timeout: 5000 });

    // Fill ID field explicitly
    const idInput = page.getByLabel("ID", { exact: true });
    await expect(idInput).toBeVisible();
    await page.waitForTimeout(200);
    await idInput.fill("test_reference");
    await expect(idInput).toHaveValue("test_reference", { timeout: 5000 });

    // Select a target collection to satisfy validation
    const targetSelect = page.getByRole("combobox", { name: "Target collection" });
    await expect(targetSelect).toBeVisible();
    await targetSelect.click();
    const usersOption = page.getByRole("option", { name: "USERS" }).first();
    await expect(usersOption).toBeVisible();
    await usersOption.click();

    await page.waitForTimeout(500); // Wait for deferred state updates

    // 8. Click Ok to add the reference property
    const okButton = page.getByRole("button", { name: "Ok" }).first();
    await expect(okButton).toBeVisible();
    await okButton.click();

    // Verify the property appears in the property list
    await expect(page.getByText("Test Reference", { exact: true })).toBeVisible({ timeout: 10000 });

    // 9. Add another property — click 'Add new property' again
    await addPropertyButton.click();
    await expect(page.getByText("Select a property widget", { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // 10. Verify that 'Relation' IS available — default engine is Postgres
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
