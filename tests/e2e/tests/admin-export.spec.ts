/**
 * Export, from a collection's toolbar to a file on disk.
 *
 * The demo declares no `admin.exportable.additionalFields`, so the export
 * here is of the collection's own columns; an additional field's `builder`
 * (which gets `row` for `entity` now) has no demo collection to run in.
 */
import fs from "node:fs";
import { test, expect } from "./admin-fixtures";
import { TestRows, anyCustomer, openCollection, orderValues, uniqueName } from "./admin-helpers";

let rows: TestRows;
test.beforeEach(({ request }) => {
    rows = new TestRows(request);
});
test.afterEach(() => rows.cleanUp());

test.describe("export", () => {
    test("exporting orders as CSV downloads every row with the collection's columns", async ({ page, request }) => {
        const customer = await anyCustomer(request);
        const orderNumber = uniqueName("E2E-EXPORT");
        await rows.create("orders", orderValues(orderNumber, customer.id, { tracking_number: "E2E-TRACK-1" }));

        await openCollection(page, "orders", "Table");
        await page.getByRole("main").getByRole("button", { name: "Export" }).click();
        const dialog = page.getByRole("dialog", { name: "Export data" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("radio", { name: "CSV" })).toBeChecked();

        const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 60_000 }),
            dialog.getByRole("button", { name: "Download" }).click()
        ]);
        expect(download.suggestedFilename()).toMatch(/\.csv$/);
        const file = await download.path();
        const csv = fs.readFileSync(file, "utf8");
        const [header, ...lines] = csv.trim().split(/\r?\n/);

        for (const column of ["order_number", "status", "customer", "order_date", "total"]) {
            expect(header, `the header has no ${column} column: ${header}`).toContain(column);
        }
        const created = lines.find(line => line.includes(orderNumber));
        expect(created, "the order made for this test is not in the file").toBeTruthy();
        expect(created).toContain("E2E-TRACK-1");
        expect(lines.length).toBeGreaterThan(100);
    });
});
