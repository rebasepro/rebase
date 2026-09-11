/**
 * Create, edit, search and delete a row through the admin panel.
 *
 * `collections.spec.ts` proves each collection view *opens*. Everything that
 * happens after that — the side panel, the save, the row appearing in the
 * table, the delete dialog — was covered at no tier, so the whole write path of
 * the product the CMS exists to be could break and the suite stayed green.
 *
 * `tags` is the collection under test because it is the smallest one that still
 * has a required field: two columns, no storage, no relations to fill in, so a
 * failure here is the write path rather than a form widget.
 */
import { test, expect, type Page } from "@playwright/test";
import { AUTH_STATE } from "../auth";
import { failOnPageErrors } from "./test-helpers";

test.use({ storageState: AUTH_STATE });

/**
 * The table's row element.
 *
 * A class selector, which is the coupling it looks like — but the collection
 * table renders no `role="row"` (nor any test id), so there is nothing more
 * stable to hold on to. Named once here so that when the table does grow a
 * proper row role, this is the single line that changes.
 */
const rowsIn = (page: Page) => page.locator(".group.flex");

test.describe("CMS Collections UI CRUD", () => {
    test.beforeEach(async ({ page }) => {
        failOnPageErrors(page);

        // The sidebar is the "session is live and collections have loaded"
        // signal the rest of this suite navigates from.
        await page.goto("/");
        await expect(page.getByRole("link").filter({ hasText: "Orders" }).first()).toBeVisible({
            timeout: 30000
        });
    });

    test("can create, edit, search, and delete an entity via CMS UI", async ({ page }) => {
        await page.goto("/c/tags");
        await expect(page).toHaveURL(/\/c\/tags/);

        const addButton = page.getByRole("button", { name: /Add/i }).first();
        await expect(addButton).toBeVisible({ timeout: 15000 });

        // ── Create ──────────────────────────────────────────────────────
        await addButton.click();

        const nameInput = page.getByRole("textbox", { name: "Tag Name" }).first();
        await expect(nameInput).toBeVisible({ timeout: 10000 });

        const tagName = `UI Tag ${Date.now()}`;
        await nameInput.fill(tagName);

        // The status is asserted on the response rather than on a toast: a form
        // that renders "Saved" without a 201 behind it is exactly the failure
        // this test is here to catch.
        //
        // The new-entity panel and the saved-entity panel have different
        // footers — "Create" here, "Save" and "Close" once the row exists — so
        // the two steps click different buttons on purpose. ("Save and close"
        // reads like the button to use in both, but it is a `menuitem` inside
        // the save split-button rather than a button: clicking it by role
        // `button` opens the menu and saves nothing.)
        const [createResponse] = await Promise.all([
            page.waitForResponse(
                res => res.url().includes("/api/data/tags") && res.request().method() === "POST"
            ),
            page.getByRole("button", { name: "Create", exact: true }).click()
        ]);
        expect(createResponse.status()).toBe(201);

        // Creating leaves the panel open on the saved row, and it covers the
        // toolbar the search step below needs. Closing it is part of the test,
        // not incidental tidying.
        await page.getByRole("button", { name: "Close", exact: true }).click();

        const createdRow = rowsIn(page).filter({ hasText: tagName }).first();
        await expect(createdRow).toBeVisible({ timeout: 15000 });

        // ── Edit ────────────────────────────────────────────────────────
        await createdRow.click();

        const editNameInput = page.getByRole("textbox", { name: "Tag Name" }).first();
        await expect(editNameInput).toBeVisible({ timeout: 10000 });

        const updatedTagName = `${tagName} (Updated)`;
        await editNameInput.fill(updatedTagName);

        const [patchResponse] = await Promise.all([
            page.waitForResponse(
                res => res.url().includes("/api/data/tags/") && res.request().method() === "PATCH"
            ),
            page.getByRole("button", { name: "Save", exact: true }).click()
        ]);
        expect(patchResponse.status()).toBe(200);

        await page.getByRole("button", { name: "Close", exact: true }).click();

        const updatedRow = rowsIn(page).filter({ hasText: updatedTagName }).first();
        await expect(updatedRow).toBeVisible({ timeout: 15000 });

        // ── Search ──────────────────────────────────────────────────────
        //
        // The row still being there proves nothing on its own — a search box
        // that filtered nothing would pass that. What it has to do is exclude
        // the rows that do not match, so the count is the assertion.
        const searchInput = page.getByPlaceholder(/Search/i).first();
        await expect(searchInput).toBeVisible();
        await expect(rowsIn(page).nth(1)).toBeVisible({ timeout: 10000 });

        await searchInput.fill(updatedTagName);
        await expect(rowsIn(page)).toHaveCount(1, { timeout: 10000 });
        await expect(updatedRow).toBeVisible();

        await searchInput.clear();
        await expect(rowsIn(page).nth(1)).toBeVisible({ timeout: 10000 });

        // ── Delete ──────────────────────────────────────────────────────
        await updatedRow.hover();
        const rowCheckbox = updatedRow.getByRole("checkbox");
        await expect(rowCheckbox).toBeVisible();
        await rowCheckbox.click();

        // The bulk action button carries the selection count.
        const deleteToolbarButton = page.locator("button").filter({ hasText: /\(1\)/ }).first();
        await expect(deleteToolbarButton).toBeVisible({ timeout: 10000 });
        await deleteToolbarButton.click();

        const deleteDialog = page.getByRole("dialog");
        await expect(deleteDialog).toBeVisible({ timeout: 5000 });

        const [deleteResponse] = await Promise.all([
            page.waitForResponse(
                res => res.url().includes("/api/data/tags/") && res.request().method() === "DELETE"
            ),
            deleteDialog.getByRole("button", { name: /^OK$/i }).click()
        ]);
        expect(deleteResponse.status()).toBe(204);

        await expect(rowsIn(page).filter({ hasText: updatedTagName })).toHaveCount(0, {
            timeout: 15000
        });
    });
});
