/**
 * What a row says about the records it points at: the demo's `admin.display`
 * resolvers that read a related record — an order's customer, an order item's
 * product image, a post's tags, a ticket's customer.
 *
 * A resolver is handed the server's row now, with a relation the panel loaded
 * nested under its name (`row.customer` is the customer's row, beside the
 * `customerId` key) — where it used to get an `Entity` whose relation held a
 * reference. Read the old way, every one of these renders nothing and the
 * card quietly falls back to a lesser line, so each is checked for the actual
 * related value, read from the API.
 */
import { test, expect, go } from "./admin-fixtures";
import {
    TestRows,
    fetchRows,
    itemFor,
    openCollection,
    orderValues,
    searchBox,
    tableRows,
    ticketValues,
    uniqueName,
    type Row
} from "./admin-helpers";

let rows: TestRows;
test.beforeEach(({ request }) => {
    rows = new TestRows(request);
});
test.afterEach(() => rows.cleanUp());

const fullName = (customer: Row) => `${customer.first_name} ${customer.last_name}`;

test.describe("display resolvers that read related records", () => {
    test("an order shows its customer's name and its total, in the list and the table", async ({ page, request }) => {
        const [, customer] = await fetchRows(request, "customers", "limit=2&orderBy=email:asc");
        const orderNumber = uniqueName("E2E-DISPLAY");
        const order = await rows.create("orders", orderValues(orderNumber, customer.id, { subtotal: 1234.5, currency: "USD" }));

        await openCollection(page, "orders", "List");
        await searchBox(page).fill(orderNumber);
        // The subtitle resolver: the related customer's full name · the money.
        await expect(itemFor(page, order.id)).toContainText(`${fullName(customer)} · $1,234.50`, { timeout: 15_000 });

        await openCollection(page, "orders", "Table");
        await searchBox(page).fill(orderNumber);
        const row = tableRows(page).filter({ hasText: orderNumber });
        await expect(row).toHaveCount(1, { timeout: 15_000 });
        await expect(row.getByRole("button", { name: fullName(customer), exact: true })).toBeVisible();
    });

    test("an order item shows its product's first image", async ({ page, request }) => {
        const products = await fetchRows(request, "products", "limit=50");
        const product = products.find(p => Array.isArray(p.images) && p.images.length > 0);
        expect(product, "no seeded product has an image").toBeTruthy();
        const [customer] = await fetchRows(request, "customers", "limit=1");
        const order = await rows.create("orders", orderValues(uniqueName("E2E-IMG"), customer.id));
        const item = await rows.create("order_items", { orderId: order.id, productId: product!.id, quantity: 1 });

        await go(page, `/c/orders/${order.id}/order_items`);
        const listed = itemFor(page, item.id);
        await expect(listed).toBeVisible({ timeout: 30_000 });
        const image = listed.locator("img").first();
        await expect(image).toBeVisible();
        // Served through storage, so the URL carries the stored path.
        const firstImage = String((product!.images as string[])[0]);
        await expect(image).toHaveAttribute("src", new RegExp(firstImage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });

    test("a post's card shows its tags by name", async ({ page, request }) => {
        const posts = await fetchRows(request, "posts", "limit=30&include=tags");
        const post = posts.find(p => Array.isArray(p.tags) && p.tags.length >= 2);
        expect(post, "no seeded post has two tags").toBeTruthy();
        const tagNames = (post!.tags as Row[]).map(tag => String(tag.name));

        await openCollection(page, "posts", "Cards");
        await searchBox(page).fill(String(post!.title));
        const card = itemFor(page, post!.id);
        await expect(card).toBeVisible({ timeout: 15_000 });
        for (const tag of tagNames) await expect(card).toContainText(tag);
    });

    test("a ticket's board card names its customer", async ({ page, request }) => {
        const [customer] = await fetchRows(request, "customers", "limit=1&orderBy=email:desc");
        const subject = uniqueName("E2E Display Ticket");
        const ticket = await rows.create("tickets", ticketValues(subject, { customerId: customer.id }));

        await openCollection(page, "tickets", "Board");
        await searchBox(page).fill(subject);
        await expect(itemFor(page, ticket.id)).toContainText(`${ticket.ticket_number} · ${fullName(customer)}`, { timeout: 15_000 });
    });

    test("a split record's header shows the payment status by its label, like the list", async ({ page, request }) => {
        // `display.tags` is the `payment_status` path, which keeps the
        // property's own rendering: the enum's label, in its colour — in the
        // record's header (`EntityDisplayHeader`) as in the list.
        const [customer] = await fetchRows(request, "customers", "limit=1");
        const orderNumber = uniqueName("E2E-TAGS");
        const order = await rows.create("orders", orderValues(orderNumber, customer.id, { payment_status: "unpaid" }));

        await openCollection(page, "orders", "List");
        await searchBox(page).fill(orderNumber);
        const listed = itemFor(page, order.id);
        await expect(listed).toContainText("Unpaid", { timeout: 15_000 });
        await listed.click({ position: { x: 240, y: 16 } });
        await expect(page).toHaveURL(new RegExp(`/c/orders/${order.id}`));
        const main = page.getByRole("main");
        // The header is drawn once its subtitle is: the customer · the total,
        // there and in the list's own row beside it.
        await expect(main.getByText(new RegExp(`^${customer.first_name} ${customer.last_name} · \\$`))).toHaveCount(2, { timeout: 15_000 });
        await expect(main.getByText("unpaid", { exact: true })).toHaveCount(0);
        await expect(main.getByText("Unpaid", { exact: true }).first()).toBeVisible();
    });
});
