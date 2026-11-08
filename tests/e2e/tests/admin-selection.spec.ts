/**
 * Selecting rows and acting on all of them: ticking and unticking, "all on
 * this page", "all matching", and a bulk delete.
 *
 * The selection is rows and ids now (`selection.type` is `"rows"` with
 * `.rows` / `.ids`, or `"query"` with `excludedIds`), where it was a list of
 * the admin's `Entity`s, and `resolveSelection` resolves a query selection to
 * rows. A selection that counts one thing and deletes another is the failure
 * this has to rule out, so every count is checked against what the server
 * holds afterwards.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./admin-fixtures";
import {
    TestRows,
    fetchRow,
    fetchRows,
    itemFor,
    items,
    openCollection,
    productValues,
    searchBox,
    uniqueName,
    type Row
} from "./admin-helpers";

let rows: TestRows;
test.beforeEach(({ request }) => {
    rows = new TestRows(request);
});
test.afterEach(() => rows.cleanUp());

/** How many rows are selected, beside the selection checkbox; absent when none are. */
const selectionCount = (page: Page) => page.getByTestId("selection-count");

/** The toolbar's bulk delete, there while something is selected. */
const bulkDelete = (page: Page) => page.getByRole("main").getByRole("button", { name: "Delete", exact: true });

/** Three products sharing a name no other row has, shown as cards and found by it. */
async function threeProducts(page: Page, label: string): Promise<Row[]> {
    const name = uniqueName(label);
    const made: Row[] = [];
    for (const n of [1, 2, 3]) made.push(await rows.create("products", productValues(`${name} ${n}`)));
    await openCollection(page, "products", "Cards");
    await searchBox(page).fill(name);
    await expect(items(page)).toHaveCount(3, { timeout: 15_000 });
    return made;
}

/** Confirms the delete dialog a bulk delete opens. */
async function confirmDelete(page: Page): Promise<void> {
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^(OK|Delete)/i }).click();
}

test.describe("selection and bulk actions", () => {
    test("ticking rows counts them, and unticking takes them off", async ({ page }) => {
        const made = await threeProducts(page, "E2E Select Product");
        await expect(selectionCount(page)).toHaveCount(0);

        await itemFor(page, made[0].id).getByRole("checkbox").check();
        await expect(selectionCount(page)).toHaveText("1");
        await expect(bulkDelete(page)).toBeVisible();
        await itemFor(page, made[1].id).getByRole("checkbox").check();
        await expect(selectionCount(page)).toHaveText("2");
        await expect(itemFor(page, made[2].id).getByRole("checkbox")).not.toBeChecked();

        await itemFor(page, made[0].id).getByRole("checkbox").uncheck();
        await expect(selectionCount(page)).toHaveText("1");
        await itemFor(page, made[1].id).getByRole("checkbox").uncheck();
        await expect(selectionCount(page)).toHaveCount(0);
        await expect(bulkDelete(page)).toHaveCount(0);
    });

    test("a bulk delete of the ticked rows deletes exactly those", async ({ page, request }) => {
        const made = await threeProducts(page, "E2E Bulk Product");

        await itemFor(page, made[0].id).getByRole("checkbox").check();
        await itemFor(page, made[1].id).getByRole("checkbox").check();
        await expect(selectionCount(page)).toHaveText("2");

        await bulkDelete(page).click();
        await confirmDelete(page);

        await expect(items(page)).toHaveCount(1, { timeout: 15_000 });
        await expect(itemFor(page, made[2].id)).toBeVisible();
        await expect(selectionCount(page)).toHaveCount(0);
        expect(await fetchRow(request, "products", made[0].id)).toBeUndefined();
        expect(await fetchRow(request, "products", made[1].id)).toBeUndefined();
        expect(await fetchRow(request, "products", made[2].id)).toBeDefined();
    });

    test("all matching selects every row, past the loaded page; unticking one takes it out", async ({ page, request }) => {
        // Orders outnumber one loaded page, so "all matching" is a query
        // selection (`excludedIds`), not a list of the rows on screen. Not
        // deleted: that would be every order in the demo.
        const total = (await fetchRows(request, "orders", "limit=1000")).length;
        await openCollection(page, "orders", "List");
        await expect(items(page).first()).toBeVisible();

        const options = page.getByRole("main").getByRole("button", { name: "Selection options" });
        await options.click();
        await page.getByRole("menuitem", { name: `All ${total} Orders` }).click();
        await expect(selectionCount(page)).toHaveText(total.toLocaleString("en-US"));
        await expect(page.getByRole("main").getByRole("checkbox", { name: "Deselect all" })).toBeChecked();

        const first = items(page).first();
        await expect(first.getByRole("checkbox")).toBeChecked();
        await first.getByRole("checkbox").uncheck();
        await expect(selectionCount(page)).toHaveText((total - 1).toLocaleString("en-US"));
        await expect(first.getByRole("checkbox")).not.toBeChecked();
        await expect(items(page).nth(1).getByRole("checkbox")).toBeChecked();

        await options.click();
        await page.getByRole("menuitem", { name: "None" }).click();
        await expect(selectionCount(page)).toHaveCount(0);
        await expect(items(page).nth(1).getByRole("checkbox")).not.toBeChecked();
    });

    test("all on this page ticks the loaded rows, and None clears them", async ({ page, request }) => {
        await openCollection(page, "orders", "List");
        await expect(items(page).first()).toBeVisible();
        const total = (await fetchRows(request, "orders", "limit=1000")).length;

        const options = page.getByRole("main").getByRole("button", { name: "Selection options" });
        await options.click();
        // "All matching" names the collection's own count.
        await expect(page.getByRole("menuitem", { name: `All ${total} Orders` })).toBeVisible();
        await page.getByRole("menuitem", { name: "All on this page" }).click();

        await expect(items(page).first().getByRole("checkbox")).toBeChecked();
        await expect(selectionCount(page)).toHaveText(/^\d+$/);
        const selected = Number(await selectionCount(page).textContent());
        expect(selected).toBeGreaterThan(0);
        expect(selected).toBeLessThan(total);

        await options.click();
        await page.getByRole("menuitem", { name: "None" }).click();
        await expect(items(page).first().getByRole("checkbox")).not.toBeChecked();
        await expect(selectionCount(page)).toHaveCount(0);
    });
});
