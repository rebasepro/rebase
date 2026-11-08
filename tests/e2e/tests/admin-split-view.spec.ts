/**
 * Master-detail: a record opened from the list view.
 *
 * No demo collection declares `openEntityMode: "split"`, but the list view
 * resolves to it (`resolveOpenEntityMode`: list and cards are master-detail
 * unless a collection says otherwise), so orders in their list view are the
 * split under test. Wide, the list and the record sit side by side; narrow,
 * the record takes the screen and the list comes back when it is closed —
 * decided by the view's own width, not the window's.
 */
import { test, expect } from "./admin-fixtures";
import { TestRows, anyCustomer, itemFor, items, openCollection, orderValues, searchBox, uniqueName } from "./admin-helpers";

let rows: TestRows;
test.beforeEach(({ request }) => {
    rows = new TestRows(request);
});
test.afterEach(() => rows.cleanUp());

test.describe("split view", () => {
    test("wide: the list and the opened record side by side, and another row replaces the record", async ({ page, request }) => {
        const customer = await anyCustomer(request);
        const prefix = uniqueName("E2E-SPLIT");
        const first = await rows.create("orders", orderValues(`${prefix}-A`, customer.id));
        const second = await rows.create("orders", orderValues(`${prefix}-B`, customer.id));

        await openCollection(page, "orders", "List");
        await searchBox(page).fill(prefix);
        await expect(items(page)).toHaveCount(2, { timeout: 15_000 });

        await itemFor(page, first.id).click({ position: { x: 240, y: 16 } });
        await expect(page).toHaveURL(new RegExp(`/c/orders/${first.id}`));
        const main = page.getByRole("main");
        await expect(main.getByRole("tab", { name: "Order", exact: true })).toBeVisible();
        await expect(main.getByText(`${prefix}-A`, { exact: true }).last()).toBeVisible();

        // Both rows are still on screen, left of the record — once the list
        // has finished narrowing into its column, which it animates.
        await expect(async () => {
            const listBox = await itemFor(page, second.id).boundingBox();
            const tabBox = await main.getByRole("tab", { name: "Order", exact: true }).boundingBox();
            expect(listBox && tabBox, "not laid out").toBeTruthy();
            expect(listBox!.x + listBox!.width, "the list and the record overlap").toBeLessThanOrEqual(tabBox!.x + 1);
        }).toPass({ timeout: 10_000 });

        // Choosing the other row replaces the record beside the list.
        await itemFor(page, second.id).click({ position: { x: 120, y: 16 } });
        await expect(page).toHaveURL(new RegExp(`/c/orders/${second.id}`));
        await expect(main.getByText(`${prefix}-B`, { exact: true }).last()).toBeVisible();
        await expect(itemFor(page, first.id)).toBeVisible();
    });

    test("narrow: the record takes the screen, and closing it brings the list back", async ({ page, request }) => {
        const customer = await anyCustomer(request);
        const orderNumber = uniqueName("E2E-NARROW");
        const order = await rows.create("orders", orderValues(orderNumber, customer.id));

        await openCollection(page, "orders", "List");
        await searchBox(page).fill(orderNumber);
        await expect(itemFor(page, order.id)).toBeVisible({ timeout: 15_000 });

        await page.setViewportSize({ width: 700, height: 900 });
        await itemFor(page, order.id).click({ position: { x: 200, y: 16 } });
        await expect(page).toHaveURL(new RegExp(`/c/orders/${order.id}`));
        const main = page.getByRole("main");
        await expect(main.getByRole("tab", { name: "Order", exact: true })).toBeVisible();
        // Drilled down: the list is not drawn beside it.
        await expect(itemFor(page, order.id)).toBeHidden();

        await main.getByRole("button", { name: "Close", exact: true }).click();
        await expect(itemFor(page, order.id)).toBeVisible();
        await expect(main.getByRole("tab", { name: "Order", exact: true })).toHaveCount(0);
    });
});
