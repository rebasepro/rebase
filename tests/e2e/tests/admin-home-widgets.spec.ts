/**
 * The demo's KPIs and charts (`app/frontend/src/InsightSlots.tsx`): on the
 * home page, and above the orders list, where a bar opens the list filtered
 * to what it counts.
 *
 * Every figure reads through the app's client (`useRebaseClient`,
 * `useRowCount`, `useAggregate`); a widget rendered outside it says "No
 * Rebase client" in place of its number, which is the regression this guards
 * along with the numbers themselves.
 */
import { test, expect, go } from "./admin-fixtures";
import { fetchRows, items, openCollection, sidePanel } from "./admin-helpers";

test.describe("home page and collection widgets", () => {
    test("the home page draws its KPIs and charts with real figures", async ({ page }) => {
        await go(page, "/");
        const main = page.getByRole("main");
        await expect(main.getByRole("heading", { name: "Last 30 days" })).toBeVisible({ timeout: 30_000 });

        for (const label of ["Total Revenue", "Orders", "Avg. Order Value", "Refunded Orders"]) {
            await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
        }
        // A money figure and a count, not a placeholder or an error.
        await expect(main.getByText(/^\$[\d.,]+K?$/).first()).toBeVisible({ timeout: 15_000 });
        await expect(main.getByText(/No Rebase client|Could not load|Error/i)).toHaveCount(0);

        // Revenue per day: a series with a point per day, readable as a table.
        await expect(main.getByRole("heading", { name: "Revenue per day" })).toBeVisible();
        const series = main.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Revenue" }) });
        await expect(series.getByRole("row").nth(10)).toBeAttached();

        // Top products: a bar per product, and a bar opens its product.
        await expect(main.getByRole("heading", { name: "Top products by revenue" })).toBeVisible();
        const firstBar = main.getByRole("listitem").getByRole("button", { name: /\$[\d,]+$/ }).first();
        await expect(firstBar).toBeVisible();
        await firstBar.click();
        await expect(sidePanel(page)).toBeVisible();
        await expect(page).toHaveURL(/\/c\/products\/[0-9a-f-]{36}/);
        await expect(sidePanel(page).getByRole("textbox", { name: "Name" })).not.toHaveValue("");
    });

    test("orders show their KPIs and a bar per status, and a bar opens the list filtered to it", async ({ page, request }) => {
        await openCollection(page, "orders", "List");
        const main = page.getByRole("main");
        await expect(main.getByRole("heading", { name: "Orders by status" })).toBeVisible({ timeout: 15_000 });
        await expect(main.getByText("Confirmed", { exact: true }).first()).toBeVisible();

        // A bar for every status, in the enum's order, each with its count.
        const bars = main.getByRole("listitem").getByRole("link");
        await expect(bars).toHaveCount(7);
        const shippedBar = bars.filter({ hasText: /^Shipped\s*\d+$/ });
        const shippedCount = Number((await shippedBar.textContent())?.match(/(\d+)$/)?.[1]);

        // The count is the database's: shipped orders dated in the last 30 days.
        const since = Date.now() - 30 * 86_400_000;
        const shipped = (await fetchRows(request, "orders", "limit=1000"))
            .filter(order => order.status === "shipped" && Date.parse(String(order.order_date)) >= since);
        expect(shippedCount).toBe(shipped.length);

        await shippedBar.click();
        await expect(page).toHaveURL(/status_op=%3D%3D&status_value=shipped/);
        await expect(page).toHaveURL(/order_date_op=%3E%3D/);
        if (shippedCount === 0) return;
        await expect(items(page).first()).toBeVisible({ timeout: 15_000 });
        await expect(async () => {
            const texts = await items(page).evaluateAll(elements => elements.map(element => element.textContent ?? ""));
            expect(texts).toHaveLength(shippedCount);
            for (const text of texts) expect(text).toContain("Shipped");
        }).toPass({ timeout: 15_000 });
    });
});
