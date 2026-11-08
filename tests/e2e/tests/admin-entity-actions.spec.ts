/**
 * A record's actions, run from where the collection draws them: the built-in
 * Edit, Copy and Delete, and the demo's own (`app/config/actions.ts`) — on a
 * table row, a card and a board card.
 *
 * Every action's `onClick`, `isEnabled` and `disabledReason` now get
 * `({ row, id, path })` where they got `({ entity })`. An action that reads
 * `entity.values.status` the old way is enabled against nothing and writes to
 * nothing, and no unit test renders it inside a real collection view. Cards
 * and board cards draw a collection's actions as of this refactor, so those
 * are covered here for the first time.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./admin-fixtures";
import {
    TestRows,
    anyCustomer,
    clickInTableRow,
    fetchRow,
    itemFor,
    items,
    openCollection,
    orderValues,
    productValues,
    searchBox,
    tableRows,
    ticketValues,
    uniqueName
} from "./admin-helpers";

let rows: TestRows;
test.beforeEach(({ request }) => {
    rows = new TestRows(request);
});
test.afterEach(() => rows.cleanUp());

/**
 * The line under a fully loaded list or grid, "All 2 entries loaded": the
 * count of the rows matching the search, which the toolbar does not show
 * while one is applied.
 */
const loadedCount = (page: Page) => page.getByRole("main").getByText(/^All \d+ entr(y|ies) loaded$/);

/** Opens orders as a table filtered to the one order numbered `orderNumber`. */
async function findOrderRow(page: Page, orderNumber: string) {
    await openCollection(page, "orders", "Table");
    await searchBox(page).fill(orderNumber);
    const row = tableRows(page).filter({ hasText: orderNumber });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    return row;
}

test.describe("entity actions", () => {
    test("Edit on a table row opens that record", async ({ page, request }) => {
        const customer = await anyCustomer(request);
        const orderNumber = uniqueName("E2E-EDIT");
        const order = await rows.create("orders", orderValues(orderNumber, customer.id));

        const row = await findOrderRow(page, orderNumber);
        // Retried: the table can still be swapping in the searched rows under
        // the pointer, and a click on a row being replaced lands on
        // nothing. Opening the record twice is harmless.
        await expect(async () => {
            await clickInTableRow(row, row.getByRole("button", { name: "Edit", exact: true }));
            await expect(page).toHaveURL(new RegExp(`/c/orders/${order.id}`), { timeout: 3_000 });
        }).toPass({ timeout: 20_000 });
        await expect(page.getByRole("textbox", { name: "Order #" })).toHaveValue(orderNumber);
    });

    test("Copy opens a new form filled from the row, and saving it adds a row", async ({ page }) => {
        const name = uniqueName("E2E Copy Product");
        await rows.create("products", productValues(name, { brand: "E2E Brand", price: 42 }));

        await openCollection(page, "products", "Cards");
        await searchBox(page).fill(name);
        await expect(items(page)).toHaveCount(1, { timeout: 15_000 });

        await items(page).first().getByRole("button", { name: "More actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "Copy", exact: true }).click();

        // A form for a new record, filled with the copied row's values.
        await expect(page).toHaveURL(/#copy/);
        const nameField = page.getByRole("textbox", { name: "Name" });
        await expect(nameField).toHaveValue(name);
        await expect(page.getByRole("textbox", { name: "Brand" })).toHaveValue("E2E Brand");

        // The SKU is unique, so the copy needs one of its own.
        const copyName = `${name} copy`;
        await nameField.fill(copyName);
        await page.getByRole("textbox", { name: "SKU" }).fill(`E2E-COPY-${Date.now().toString(36)}`);
        const [created] = await Promise.all([
            page.waitForResponse(res => res.url().includes("/api/data/products") && res.request().method() === "POST"),
            page.getByRole("button", { name: "Create copy" }).click()
        ]);
        expect(created.status()).toBe(201);
        const copy = (await created.json()) as { id: string; name: string; brand: string; price: number };
        rows.adopt("products", copy.id);
        expect(copy).toMatchObject({ name: copyName, brand: "E2E Brand", price: 42 });

        // Both rows are in the collection: the search for the original's name
        // now finds two, and the view counts two.
        await openCollection(page, "products", "Cards");
        await searchBox(page).fill(name);
        await expect(items(page)).toHaveCount(2, { timeout: 15_000 });
        await expect(loadedCount(page)).toHaveText("All 2 entries loaded");
    });

    test("Delete removes the row and the count goes down", async ({ page }) => {
        const name = uniqueName("E2E Delete Product");
        const kept = await rows.create("products", productValues(`${name} kept`));
        const doomed = await rows.create("products", productValues(`${name} doomed`));

        await openCollection(page, "products", "Cards");
        await searchBox(page).fill(name);
        await expect(items(page)).toHaveCount(2, { timeout: 15_000 });
        await expect(loadedCount(page)).toHaveText("All 2 entries loaded");

        await itemFor(page, doomed.id).getByRole("button", { name: "More actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const [deleted] = await Promise.all([
            page.waitForResponse(res => res.url().includes(`/api/data/products/${doomed.id}`) && res.request().method() === "DELETE"),
            dialog.getByRole("button", { name: /^(OK|Delete)$/i }).click()
        ]);
        expect(deleted.status()).toBe(204);

        await expect(itemFor(page, doomed.id)).toHaveCount(0, { timeout: 15_000 });
        await expect(itemFor(page, kept.id)).toBeVisible();
        await expect(loadedCount(page)).toHaveText(/^All 1 entr(y|ies) loaded$/);
    });

    test("an order's Mark as shipped, on its table row, ships it", async ({ page, request }) => {
        const customer = await anyCustomer(request);
        const orderNumber = uniqueName("E2E-SHIP");
        const order = await rows.create("orders", orderValues(orderNumber, customer.id, { status: "pending", payment_status: "paid" }));

        const row = await findOrderRow(page, orderNumber);
        await expect(row.getByText("Pending", { exact: true })).toBeVisible();

        // Retried for the reason Edit is (see above), but only while the order
        // is still unshipped: a second ship would be a second write.
        const ship = row.getByRole("button", { name: "Mark as shipped", exact: true });
        await expect(async () => {
            if ((await fetchRow(request, "orders", order.id))?.status !== "shipped") {
                await clickInTableRow(row, ship);
            }
            await expect.poll(async () => (await fetchRow(request, "orders", order.id))?.status, { timeout: 3_000 }).toBe("shipped");
        }).toPass({ timeout: 20_000 });

        await expect(row.getByText("Shipped", { exact: true })).toBeVisible({ timeout: 15_000 });
        const saved = await fetchRow(request, "orders", order.id);
        expect(saved?.status).toBe("shipped");
        expect(String(saved?.tracking_number ?? "")).toMatch(/^1Z/);
        expect(Number.isNaN(Date.parse(String(saved?.shipped_date)))).toBe(false);
    });

    test("an action that does not apply is disabled and says why", async ({ page, request }) => {
        // Unpaid: the order cannot ship yet, and the menu says so.
        const customer = await anyCustomer(request);
        const orderNumber = uniqueName("E2E-UNPAID");
        await rows.create("orders", orderValues(orderNumber, customer.id, { status: "pending", payment_status: "unpaid" }));

        const row = await findOrderRow(page, orderNumber);
        await row.hover();
        await expect(row.getByRole("button", { name: "Mark as shipped", exact: true })).toBeDisabled();
        await clickInTableRow(row, row.getByRole("button", { name: "More actions", exact: true }));
        await expect(page.getByRole("menuitem", { name: /^Refund/ })).toBeDisabled();
        await expect(page.getByRole("menuitem", { name: /^Refund/ })).toContainText("Nothing to refund: the order is not paid");
    });

    test("a product card's Publish makes it active, and the card says so", async ({ page, request }) => {
        const name = uniqueName("E2E Publish Product");
        const product = await rows.create("products", productValues(name, { status: "draft" }));

        await openCollection(page, "products", "Cards");
        await searchBox(page).fill(name);
        const card = itemFor(page, product.id);
        await expect(card).toContainText("Draft", { timeout: 15_000 });
        const publish = card.getByRole("button", { name: "Publish", exact: true });
        await expect(publish).toBeEnabled();

        await publish.click();
        await expect(page.getByText("Product published")).toBeVisible();
        await expect.poll(async () => (await fetchRow(request, "products", product.id))?.status).toBe("active");
        // `status` is a property path, drawn from the row: the chip and the
        // action's `isEnabled` both follow the write without a reload.
        await expect(card).toContainText("Active", { timeout: 15_000 });
        await expect(publish).toBeDisabled();
    });

    test("a product card's Restock adds 50 units, and its computed subtitle shows them", async ({ page, request }) => {
        // The subtitle is a display *resolver* ("$12.50 · 7 in stock"), whose
        // answer is cached per record and role: it is resolved again because
        // the row it was computed from changed.
        const name = uniqueName("E2E Restock Product");
        const product = await rows.create("products", productValues(name, { stock_quantity: 7 }));

        await openCollection(page, "products", "Cards");
        await searchBox(page).fill(name);
        const card = itemFor(page, product.id);
        await expect(card).toContainText("7 in stock", { timeout: 15_000 });

        await card.getByRole("button", { name: "Restock 50 units" }).click();
        await expect(page.getByText("Added 50 units to stock")).toBeVisible();
        await expect.poll(async () => (await fetchRow(request, "products", product.id))?.stock_quantity).toBe(57);
        await expect(card).toContainText("57 in stock", { timeout: 10_000 });
    });

    test("a ticket's Resolve, on its board card, moves it to Resolved", async ({ page, request }) => {
        const subject = uniqueName("E2E Resolve Ticket");
        const ticket = await rows.create("tickets", ticketValues(subject, { status: "open" }));

        await openCollection(page, "tickets", "Board");
        await searchBox(page).fill(subject);
        const card = itemFor(page, ticket.id);
        const openColumn = page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Open item list" }) });
        const resolvedColumn = page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Resolved item list" }) });
        await expect(openColumn.locator(card)).toBeVisible({ timeout: 15_000 });

        await card.getByRole("button", { name: "Resolve", exact: true }).click();
        await expect(page.getByText("Ticket resolved")).toBeVisible();
        await expect(resolvedColumn.locator(itemFor(page, ticket.id))).toBeVisible({ timeout: 15_000 });
        expect((await fetchRow(request, "tickets", ticket.id))?.status).toBe("resolved");
    });

    test("a board card's ⋮ menu offers the collection's actions and the built-ins", async ({ page, request }) => {
        const subject = uniqueName("E2E Menu Ticket");
        const ticket = await rows.create("tickets", ticketValues(subject, { status: "open", priority: "low" }));

        await openCollection(page, "tickets", "Board");
        await searchBox(page).fill(subject);
        const card = itemFor(page, ticket.id);
        await expect(card).toBeVisible({ timeout: 15_000 });

        await card.getByRole("button", { name: "More actions", exact: true }).click();
        const menu = page.getByRole("menu");
        await expect(menu.getByRole("menuitem", { name: "Copy", exact: true })).toBeVisible();
        await expect(menu.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
        await menu.getByRole("menuitem", { name: /^Escalate priority/ }).click();
        await expect(page.getByText("Priority raised to medium")).toBeVisible();
        await expect.poll(async () => (await fetchRow(request, "tickets", ticket.id))?.priority).toBe("medium");
    });

    test("an action's write reaches every view of the collection that is open", async ({ page, request }) => {
        // The list and the record beside it read the same row: an action run
        // from the record's bar updates the list too.
        const customer = await anyCustomer(request);
        const orderNumber = uniqueName("E2E-SPLIT-SHIP");
        const order = await rows.create("orders", orderValues(orderNumber, customer.id, { status: "confirmed", payment_status: "paid" }));

        await openCollection(page, "orders", "List");
        await searchBox(page).fill(orderNumber);
        const listed = itemFor(page, order.id);
        await expect(listed).toContainText("Confirmed", { timeout: 15_000 });
        await listed.click({ position: { x: 240, y: 16 } });
        await expect(page).toHaveURL(new RegExp(`/c/orders/${order.id}`));

        // The master column is narrow and draws no chips, so the record's own
        // bar is where the change shows; closing the record widens the list
        // again, and it shows the new status too.
        const ship = page.getByRole("main").getByRole("button", { name: "Mark as shipped", exact: true }).last();
        await ship.click();
        await expect(page.getByText("Order marked as shipped")).toBeVisible();
        await expect(ship).toBeDisabled({ timeout: 15_000 });
        await page.getByRole("main").getByRole("button", { name: "Close", exact: true }).click();
        await expect(listed).toContainText("Shipped", { timeout: 15_000 });
    });
});
