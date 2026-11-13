/**
 * The demo's custom collection view, `ProductPriceMapView` (registered with
 * `collectionViews`, named in products' `admin.customViews`): it draws the
 * collection's rows, the toolbar's query drives it, and a point opens its
 * record.
 *
 * A custom view gets a `TableController` of rows now (`.rows`, `.loading`,
 * `onRowClick(row)`), where it got the admin's entities (`.data`,
 * `onEntityClick`) — so a view written either way is exercised only by
 * running it.
 */
import { test, expect } from "./admin-fixtures";
import { TestRows, openCollection, productValues, searchBox, sidePanel, uniqueName } from "./admin-helpers";

let rows: TestRows;
test.beforeEach(({ request }) => {
    rows = new TestRows(request);
});
test.afterEach(() => rows.cleanUp());

test.describe("custom collection view", () => {
    test("the Price map plots the products the search finds, and a point opens its product", async ({ page }) => {
        const name = uniqueName("E2E Map Product");
        const product = await rows.create("products", productValues(name, { price: 49, rating: 4.2, stock_quantity: 30 }));

        await openCollection(page, "products", "Price map");
        await expect(page).toHaveURL(/__view=price-map/);
        const map = page.getByRole("img", { name: /^\d+ products plotted by price and rating$/ });
        await expect(map).toBeVisible({ timeout: 15_000 });
        // Every rated product is a point: the map reads the rows the table does.
        // The rows arrive in pages, so the three counts — the label, the
        // points and the caption — are read together until they agree.
        const caption = page.getByRole("main").getByText(/^\d+ plotted$/);
        const agreed = async (): Promise<number> => {
            const labelled = Number((await map.getAttribute("aria-label"))?.match(/^(\d+)/)?.[1]);
            const captioned = Number((await caption.textContent())?.match(/^(\d+)/)?.[1]);
            const points = await map.locator("circle").count();
            return labelled === captioned && labelled === points ? labelled : -1;
        };
        await expect.poll(agreed, { timeout: 15_000 }).toBeGreaterThan(50);

        // The search box above drives it: one product found, one point.
        await searchBox(page).fill(name);
        await expect(page.getByRole("img", { name: "1 products plotted by price and rating" })).toBeVisible({ timeout: 15_000 });
        await expect(map.locator("circle")).toHaveCount(1);

        // The point is that product: clicking it opens it in the side panel.
        await map.locator("circle").click();
        const panel = sidePanel(page);
        await expect(panel).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/c/products/${product.id}`));
        await expect(panel.getByRole("textbox", { name: "Name" })).toHaveValue(name);
    });
});
