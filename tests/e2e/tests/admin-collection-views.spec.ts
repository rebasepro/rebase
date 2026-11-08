/**
 * A collection's views — table, list, cards, board — against the demo's real
 * collections: each draws the rows, the toolbar switches between them, and
 * search, filter presets, sorting and paging change what they draw.
 *
 * `collections.spec.ts` proves each collection opens; this is what happens on
 * it. Every view is a different component reading the same rows, and the rows
 * changed shape (one row shape: the server's row, not the admin's `Entity`),
 * so a view that reads a field the old way draws blanks without failing.
 */
import type { Page } from "@playwright/test";
import { test, expect, go } from "./admin-fixtures";
import {
    TestRows,
    anyCustomer,
    fetchRows,
    items,
    openCollection,
    orderValues,
    productValues,
    searchBox,
    switchViewMode,
    tableRows,
    uniqueName,
    viewModeButton
} from "./admin-helpers";

const ORDER_STATUSES = ["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled", "Refunded"];

/** The order numbers drawn by the list view, top to bottom. */
async function listedOrderNumbers(page: Page): Promise<string[]> {
    const names = await items(page).evaluateAll(elements =>
        elements.map(element => element.getAttribute("aria-label") ?? element.textContent ?? ""));
    return names.flatMap(name => name.match(/ORD-\d{4}-\d{4}/)?.[0] ?? []);
}

test.describe("collection views", () => {
    test("orders draw their rows as a table, a list, cards and a board", async ({ page, request }) => {
        // The first row in the default order (`id` descending), read from the
        // API, is the one every view must start with.
        const [first] = await fetchRows(request, "orders", "limit=1&orderBy=id:desc");
        const firstNumber = String(first.order_number);

        await openCollection(page, "orders", "Table");
        await expect(tableRows(page).filter({ hasText: firstNumber })).toBeVisible();
        expect(await tableRows(page).filter({ hasText: /ORD-/ }).count()).toBeGreaterThan(5);

        await switchViewMode(page, "List");
        await expect(items(page).first()).toContainText(firstNumber);
        expect(await items(page).count()).toBeGreaterThan(5);

        await switchViewMode(page, "Cards");
        await expect(items(page).first()).toContainText(firstNumber);
        expect(await items(page).count()).toBeGreaterThan(5);

        // A column per status, in the enum's order, each with its count.
        await switchViewMode(page, "Board");
        for (const status of ORDER_STATUSES) {
            await expect(page.getByRole("heading", { name: `${status} item list` })).toBeVisible();
        }
        await expect(items(page).filter({ hasText: firstNumber })).toBeVisible();
    });

    test("the view mode chosen stays across a reload", async ({ page }) => {
        await openCollection(page, "orders", "Cards");
        await expect(items(page).first()).toBeVisible();
        await page.reload();
        await expect(viewModeButton(page)).toHaveText("Cards");
        await expect(items(page).first()).toBeVisible();
    });

    test("a collection with two rows is as tall as its rows, not a page-high box", async ({ page, request }) => {
        // An order's Order Items tab: a collection panel with no height of its
        // own, inside the record page. It sizes to its rows.
        const rows = new TestRows(request);
        try {
            const customer = await anyCustomer(request);
            const [product] = await fetchRows(request, "products", "limit=1");
            const order = await rows.create("orders", orderValues(uniqueName("E2E-SIZE"), customer.id));
            for (const quantity of [1, 2]) {
                await rows.create("order_items", { orderId: order.id, productId: product.id, quantity });
            }

            await go(page, `/c/orders/${order.id}/order_items`);
            const list = page.getByRole("main").getByText("All 2 entries loaded");
            await expect(list).toBeVisible({ timeout: 30_000 });
            await expect(items(page)).toHaveCount(2);

            // The panel ends just under its last row: the space between that
            // row and the "All loaded" line is a few pixels, not the rest of
            // the window.
            const lastRow = await items(page).last().boundingBox();
            const footer = await list.boundingBox();
            const viewport = page.viewportSize();
            expect(lastRow && footer && viewport, "not laid out").toBeTruthy();
            expect(footer!.y - (lastRow!.y + lastRow!.height), "empty space under the rows").toBeLessThan(80);
            expect(footer!.y + footer!.height, "the panel reaches the bottom of the window")
                .toBeLessThan(viewport!.height - 120);
        } finally {
            await rows.cleanUp();
        }
    });

    test("search narrows the rows to the ones that match, and clearing it brings them back", async ({ page, request }) => {
        const rows = new TestRows(request);
        try {
            const name = uniqueName("E2E Search Product");
            const product = await rows.create("products", productValues(name));

            await openCollection(page, "products", "Cards");
            await expect(items(page).nth(5)).toBeVisible();

            await searchBox(page).fill(name);
            await expect(items(page)).toHaveCount(1, { timeout: 15_000 });
            await expect(items(page).first()).toHaveAccessibleName(new RegExp(`^Select ${product.id}`));

            await searchBox(page).clear();
            await expect(items(page).nth(5)).toBeVisible({ timeout: 15_000 });
        } finally {
            await rows.cleanUp();
        }
    });

    test("a filter preset shows only the rows it names, and turning it off shows the rest", async ({ page }) => {
        await openCollection(page, "orders", "List");
        await expect(items(page).first()).toBeVisible();

        const preset = page.getByRole("button", { name: "Shipped orders" });
        await preset.click();
        await expect(page).toHaveURL(/status/);
        await expect(items(page).first()).toBeVisible();
        // Every row on screen is a shipped one.
        await expect(async () => {
            const names = await items(page).evaluateAll(elements => elements.map(element => element.textContent ?? ""));
            expect(names.length).toBeGreaterThan(0);
            for (const name of names) expect(name).toContain("Shipped");
        }).toPass({ timeout: 15_000 });

        await preset.click();
        await expect(async () => {
            const names = await items(page).evaluateAll(elements => elements.map(element => element.textContent ?? ""));
            expect(names.some(name => !name.includes("Shipped"))).toBe(true);
        }).toPass({ timeout: 15_000 });
    });

    test("sorting by a column orders the rows by it, ascending then descending", async ({ page }) => {
        await openCollection(page, "orders", "List");
        await expect(items(page).first()).toBeVisible();

        const header = page.getByRole("button", { name: /^Order # — Sort/ });
        await header.click();
        await expect(async () => {
            const numbers = await listedOrderNumbers(page);
            expect(numbers.length).toBeGreaterThan(5);
            expect(numbers).toEqual([...numbers].sort());
        }).toPass({ timeout: 15_000 });

        await page.getByRole("button", { name: /^Order # — / }).click();
        await expect(async () => {
            const numbers = await listedOrderNumbers(page);
            expect(numbers.length).toBeGreaterThan(5);
            expect(numbers).toEqual([...numbers].sort().reverse());
        }).toPass({ timeout: 15_000 });
    });

    test("scrolling to the end of a long table loads the rows after the first page", async ({ page, request }) => {
        // The last order in the table's order (`id` descending) is the one with
        // the smallest id: it is on the last page, so it reaches the DOM only
        // once the table has asked for the pages before it.
        const [last] = await fetchRows(request, "orders", "limit=1&orderBy=id:asc");
        const lastNumber = String(last.order_number);

        await openCollection(page, "orders", "Table");
        await expect(tableRows(page).filter({ hasText: /ORD-/ }).first()).toBeVisible();
        await expect(tableRows(page).filter({ hasText: lastNumber })).toHaveCount(0);

        const pageRequests: string[] = [];
        page.on("request", req => {
            if (req.url().includes("/api/data/orders") && req.method() === "GET") pageRequests.push(req.url());
        });

        // Scrolled by the wheel over the table, as a person would, until the
        // last row arrives.
        const firstRow = tableRows(page).filter({ hasText: /ORD-/ }).first();
        await firstRow.hover();
        await expect(async () => {
            await page.mouse.wheel(0, 4000);
            await expect(tableRows(page).filter({ hasText: lastNumber })).toBeVisible({ timeout: 1_500 });
        }).toPass({ timeout: 45_000 });
        expect(pageRequests.length, "the table loaded the later rows without asking the server").toBeGreaterThan(0);
    });
});
