/**
 * The side panel: a record opened over its collection, edited and saved
 * there, and closed back onto the list it came from.
 *
 * The panel's save callback is `onSaved({ row, id })` now, renamed from
 * `onUpdate`, and the panel is opened with `open({ path, id })` where it took
 * `entityId`. Its URL is meant to be unchanged — saved links keep opening —
 * which is asserted here too.
 *
 * Tickets open in the side panel because their default view is the board,
 * and a board keeps its columns behind an overlay (`resolveOpenEntityMode`).
 */
import { test, expect, go } from "./admin-fixtures";
import {
    TestRows,
    anyCustomer,
    fetchRow,
    fetchRows,
    itemFor,
    items,
    openCollection,
    orderValues,
    searchBox,
    sidePanel,
    ticketValues,
    uniqueName
} from "./admin-helpers";

let rows: TestRows;
test.beforeEach(({ request }) => {
    rows = new TestRows(request);
});
test.afterEach(() => rows.cleanUp());

test.describe("side panel", () => {
    test("a board card opens in the side panel; a save there updates the card", async ({ page, request }) => {
        const subject = uniqueName("E2E Panel Ticket");
        const ticket = await rows.create("tickets", ticketValues(subject));

        await openCollection(page, "tickets", "Board");
        await searchBox(page).fill(subject);
        const card = itemFor(page, ticket.id);
        await expect(card).toBeVisible({ timeout: 15_000 });

        await card.getByText(subject).click();
        const panel = sidePanel(page);
        await expect(panel).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/c/tickets/${ticket.id}.*#side`));
        const subjectField = panel.getByRole("textbox", { name: "Subject" });
        await expect(subjectField).toHaveValue(subject);

        // Save keeps the panel open on the saved record.
        const edited = `${subject} edited`;
        await subjectField.fill(edited);
        const [patch] = await Promise.all([
            page.waitForResponse(res => res.url().includes(`/api/data/tickets/${ticket.id}`) && res.request().method() === "PATCH"),
            panel.getByRole("button", { name: "Save", exact: true }).click()
        ]);
        expect(patch.status()).toBe(200);
        await expect(panel).toBeVisible();
        await expect(panel.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
        expect((await fetchRow(request, "tickets", ticket.id))?.subject).toBe(edited);

        // Close returns to the board, with the URL of the board, and the card
        // (titled by the subject) shows the saved value.
        await panel.getByRole("button", { name: "Close", exact: true }).first().click();
        await expect(panel).toHaveCount(0);
        await expect(page).toHaveURL(/\/c\/tickets(\?[^#]*)?$/);
        await expect(card).toContainText(edited, { timeout: 15_000 });

        // Reopened, it reads the saved value.
        await card.getByText(edited).click();
        await expect(sidePanel(page).getByRole("textbox", { name: "Subject" })).toHaveValue(edited);
    });

    test("Save and close saves and closes the panel", async ({ page, request }) => {
        const subject = uniqueName("E2E Save Close Ticket");
        const ticket = await rows.create("tickets", ticketValues(subject));

        await openCollection(page, "tickets", "Board");
        await searchBox(page).fill(subject);
        await itemFor(page, ticket.id).getByText(subject).click();
        const panel = sidePanel(page);
        const field = panel.getByRole("textbox", { name: "Subject" });
        await expect(field).toHaveValue(subject);

        await field.fill(`${subject} closed`);
        await panel.getByRole("button", { name: "Save and close" }).click();
        await expect(panel).toHaveCount(0, { timeout: 15_000 });
        await expect(itemFor(page, ticket.id)).toContainText(`${subject} closed`);
        expect((await fetchRow(request, "tickets", ticket.id))?.subject).toBe(`${subject} closed`);
    });

    test("a saved panel link opens the record in the panel over its collection", async ({ page }) => {
        const subject = uniqueName("E2E Link Ticket");
        const ticket = await rows.create("tickets", ticketValues(subject));

        await page.goto(`/c/tickets/${ticket.id}#side`);
        const panel = sidePanel(page);
        await expect(panel.getByRole("textbox", { name: "Subject" })).toHaveValue(subject, { timeout: 30_000 });
        // The collection is drawn behind it (hidden from the accessibility
        // tree while the modal panel is open), and is there once it closes.
        await expect(page.getByRole("heading", { name: "Open item list", includeHidden: true })).toBeAttached();
        await panel.getByRole("button", { name: "Close", exact: true }).first().click();
        await expect(page.getByRole("heading", { name: "Open item list" })).toBeVisible();
    });

    test("a subcollection record opens at its nested path, and reopens there", async ({ page, request }) => {
        const customer = await anyCustomer(request);
        const [product] = await fetchRows(request, "products", "limit=1");
        const order = await rows.create("orders", orderValues(uniqueName("E2E-SUB"), customer.id));
        const item = await rows.create("order_items", { orderId: order.id, productId: product.id, quantity: 3 });

        await go(page, `/c/orders/${order.id}/order_items`);
        const listed = itemFor(page, item.id);
        await expect(listed).toBeVisible({ timeout: 30_000 });
        await listed.click({ position: { x: 300, y: 16 } });

        // The path names the parent, the relation and the item.
        await expect(page).toHaveURL(new RegExp(`/c/orders/${order.id}/order_items/${item.id}`));
        await expect(page.getByRole("spinbutton", { name: "Quantity" }).or(page.getByText("Quantity")).first()).toBeVisible();

        // Reloading that URL opens the same record.
        await page.reload();
        await expect(page).toHaveURL(new RegExp(`/c/orders/${order.id}/order_items/${item.id}`));
        await expect(page.getByRole("main").getByText(String(product.name ?? item.product_name)).first()).toBeVisible({ timeout: 30_000 });
    });

    test("a point on the custom Price map view opens that product in the side panel", async ({ page }) => {
        await openCollection(page, "products", "Price map");
        const map = page.getByRole("img", { name: /products plotted by price and rating/ });
        await expect(map).toBeVisible();
        const points = map.locator("circle");
        await expect(points.first()).toBeAttached();
        expect(await points.count()).toBeGreaterThan(10);

        // The last point is drawn on top of the others, so it is the one a
        // click reaches.
        await points.last().click();
        const panel = sidePanel(page);
        await expect(panel).toBeVisible();
        await expect(page).toHaveURL(/\/c\/products\/[0-9a-f-]{36}.*#side/);
        await expect(panel.getByRole("textbox", { name: "Name" })).not.toHaveValue("");
        await expect(items(page)).toHaveCount(0);
    });
});
