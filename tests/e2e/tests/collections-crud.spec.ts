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

        // The list is ordered `id DESC` — the total-order tiebreak every sort
        // ends on — over a primary key that is a random UUID, so a new row
        // lands at a uniformly random position among the ~30 seeded tags. The
        // table renders a window of about 19 rows, and a row outside it is not
        // in the DOM at all, which is why this read as "element(s) not found"
        // rather than as something off screen.
        //
        // Asserting on the unfiltered list was therefore a coin flip weighted
        // roughly 60/40, and it came up tails on CI runs 34641904527 and
        // 35124051045 — all three attempts each, because every retry leaks its
        // tag and lengthens the list it is about to lose to.
        //
        // Searching first is what gives "the row reached the table" an answer.
        // It does not weaken the assertion: the row still has to render, and
        // the search box has to exclude, which is asserted below.
        const searchInput = page.getByPlaceholder(/Search/i).first();
        await expect(searchInput).toBeVisible();
        await searchInput.fill(tagName);

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

        // Re-applied, not assumed: opening a record and closing it resets the
        // toolbar, and the search term goes with it — the list comes back
        // unfiltered at its full count. Without this the row is back to being
        // a lottery ticket in the rendered window.
        await expect(searchInput).toBeVisible();
        await searchInput.fill(updatedTagName);

        const updatedRow = rowsIn(page).filter({ hasText: updatedTagName }).first();
        await expect(updatedRow).toBeVisible({ timeout: 15000 });

        // ── Search ──────────────────────────────────────────────────────
        //
        // The row still being there proves nothing on its own — a search box
        // that filtered nothing would pass that. What it has to do is exclude
        // the rows that do not match, so the count is the assertion. Clearing
        // first is what gives that count something to exclude.
        await searchInput.clear();
        await expect(rowsIn(page).nth(1)).toBeVisible({ timeout: 10000 });

        await searchInput.fill(updatedTagName);
        await expect(rowsIn(page)).toHaveCount(1, { timeout: 10000 });
        await expect(updatedRow).toBeVisible();

        // ── Delete ──────────────────────────────────────────────────────
        //
        // Deleted from the filtered list on purpose. Clearing the search here
        // would drop the row back to its random position in a list the table
        // only partly renders — the coin flip above wearing a different hat.
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
