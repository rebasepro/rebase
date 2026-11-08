/**
 * The record form, saving to a real database: validation that stops a save,
 * a relation picked from its target collection and saved as the foreign key,
 * a date that comes back as the instant it was saved as, and the collection's
 * callbacks running on the save.
 *
 * The form's values stay form values (a `Date`, a relation object), and the
 * server's row is ISO strings and a `customerId` column: the conversion
 * between the two moved in this refactor, and it is exactly the kind of bug a
 * unit test with a hand-written row cannot catch — an hour lost to a time
 * zone, a relation saved as `[object Object]`.
 *
 * The browser runs in New York (see `admin-fixtures.ts`), so a date handled
 * as UTC anywhere on the way shows up as a four- or five-hour shift.
 */
import type { Page } from "@playwright/test";
import { test, expect, go } from "./admin-fixtures";
import { TestRows, anyCustomer, fetchRow, fetchRows, orderValues, uniqueName, type Row } from "./admin-helpers";

let rows: TestRows;
test.beforeEach(({ request }) => {
    rows = new TestRows(request);
});
test.afterEach(() => rows.cleanUp());

/** The new-order form, full screen (orders open full screen from their table). */
async function openNewOrder(page: Page) {
    await go(page, "/c/orders#new");
    await expect(page.getByRole("textbox", { name: "Order #" })).toBeVisible({ timeout: 30_000 });
}

/** Picks `customer` in the order form's Customer field, through its search. */
async function pickCustomer(page: Page, customer: Row) {
    const field = page.locator("[data-form-field=customer]");
    await field.getByRole("button", { name: "Select…" }).click();
    const picker = page.getByRole("dialog").filter({ has: page.getByRole("listbox") });
    await expect(picker).toBeVisible();
    await picker.getByRole("combobox").fill(String(customer.email));
    const option = picker.getByRole("option", { name: new RegExp(String(customer.email).replace(/[.+]/g, "\\$&")) });
    await expect(option).toHaveCount(1, { timeout: 15_000 });
    await option.click();
    await expect(picker).toHaveCount(0);
    await expect(field).toContainText(`${customer.first_name} ${customer.last_name}`);
}

test.describe("record form", () => {
    test("a required field left empty stops the save and is marked", async ({ page }) => {
        await openNewOrder(page);

        let posted = false;
        page.on("request", req => {
            if (req.url().includes("/api/data/orders") && req.method() === "POST") posted = true;
        });
        await page.getByRole("button", { name: "Create", exact: true }).click();

        await expect(page.getByRole("alert").filter({ hasText: "Fix highlighted errors before saving" })).toBeVisible();
        const orderNumber = page.getByRole("textbox", { name: "Order #" });
        await expect(orderNumber).toHaveAttribute("aria-invalid", "true");
        await expect(page.locator("[data-form-field=order_number]")).toContainText("Required");
        await expect(page.locator("[data-form-field=customer]")).toContainText("Required");
        await expect(page.locator("[data-form-field=order_date]")).toContainText("Required");
        await expect(page).toHaveURL(/#new/);
        expect(posted, "the form sent a create with a required field empty").toBe(false);

    });

    test("a customer picked in the relation field is saved as the order's customerId", async ({ page, request }) => {
        // Not the first customer, so a picker that saved whichever row it
        // happened to show first would be caught.
        const customers = await fetchRows(request, "customers", "limit=5&orderBy=email:asc");
        const customer = customers[3];
        const orderNumber = uniqueName("E2E-PICK");

        await openNewOrder(page);
        await page.getByRole("textbox", { name: "Order #" }).fill(orderNumber);
        await pickCustomer(page, customer);
        await page.getByRole("textbox", { name: "Order Date" }).fill("2026-03-15T09:30");

        const [created] = await Promise.all([
            page.waitForResponse(res => res.url().includes("/api/data/orders") && res.request().method() === "POST"),
            page.getByRole("button", { name: "Create", exact: true }).click()
        ]);
        expect(created.status(), await created.text()).toBe(201);
        const order = (await created.json()) as Row;
        rows.adopt("orders", order.id);

        const saved = await fetchRow(request, "orders", order.id, "customer");
        expect(saved?.customerId).toBe(customer.id);
        expect((saved?.customer as Row | undefined)?.email).toBe(customer.email);
        expect(saved?.order_number).toBe(orderNumber);
    });

    test("a date saved in the form is the same instant on the server and after a reload", async ({ page, request }) => {
        const customer = await anyCustomer(request);
        const order = await rows.create("orders", orderValues(uniqueName("E2E-DATE"), customer.id, {
            order_date: "2026-01-10T15:00:00.000Z"
        }));

        await go(page, `/c/orders/${order.id}/edit`);
        const dateField = page.getByRole("textbox", { name: "Order Date" });
        // 15:00 UTC in January is 10:00 in New York (EST, UTC-5).
        await expect(dateField).toHaveValue("2026-01-10T10:00", { timeout: 30_000 });

        // 09:30 on a summer day in New York is 13:30 UTC (EDT, UTC-4).
        await dateField.fill("2026-07-04T09:30");
        const [patch] = await Promise.all([
            page.waitForResponse(res => res.url().includes(`/api/data/orders/${order.id}`) && res.request().method() === "PATCH"),
            page.getByRole("button", { name: "Save", exact: true }).click()
        ]);
        expect(patch.status(), await patch.text()).toBe(200);
        expect((await fetchRow(request, "orders", order.id))?.order_date).toBe("2026-07-04T13:30:00.000Z");

        // Saved, the record shows read-only; loaded again in its form, the
        // field holds the time that was typed.
        await page.goto(`/c/orders/${order.id}/edit`);
        await expect(page.getByRole("textbox", { name: "Order Date" })).toHaveValue("2026-07-04T09:30", { timeout: 30_000 });
    });

    test("clearing a clearable date saves null", async ({ page, request }) => {
        // KNOWN BUG, reported: "Clear date" empties the form's value — the
        // save below sends `shipped_date: null` — but the input goes on
        // drawing the old date until the record is opened again. Remove
        // `test.fail` with the fix.
        test.fail();
        const customer = await anyCustomer(request);
        const order = await rows.create("orders", orderValues(uniqueName("E2E-CLEAR"), customer.id, {
            shipped_date: "2026-02-01T12:00:00.000Z"
        }));

        await go(page, `/c/orders/${order.id}/edit`);
        const shipped = page.locator("[data-form-field=shipped_date]");
        await expect(shipped.getByRole("textbox")).not.toHaveValue("", { timeout: 30_000 });
        await shipped.getByRole("button", { name: "Clear date" }).click();
        await expect(shipped.getByRole("textbox")).toHaveValue("");

        const [patch] = await Promise.all([
            page.waitForResponse(res => res.url().includes(`/api/data/orders/${order.id}`) && res.request().method() === "PATCH"),
            page.getByRole("button", { name: "Save", exact: true }).click()
        ]);
        expect(patch.status(), await patch.text()).toBe(200);
        expect((await fetchRow(request, "orders", order.id))?.shipped_date).toBeNull();
    });

    test("the collection's callbacks run on a save from the form: the total is recomputed", async ({ page, request }) => {
        // Orders declare `callbacks.beforeSave`, which keeps `total` equal to
        // subtotal + tax + shipping − discount. The demo declares no
        // `browserCallbacks`, so this is the server half of a save.
        //
        // KNOWN BUG, reported (in the demo, not the framework): the form
        // saves an existing record as a PATCH of the changed fields only, and
        // `values` in a server `beforeSave` is that partial row. The demo's
        // callback reads `values.subtotal ?? 0`, so a save that changes the
        // shipping computes the total from a subtotal of 0 (here 10, not 110).
        // It has to read `{ ...previousValues, ...values }`. Remove
        // `test.fail` with the fix in `app/config/collections/orders.ts`.
        test.fail();
        const customer = await anyCustomer(request);
        const order = await rows.create("orders", orderValues(uniqueName("E2E-TOTAL"), customer.id, {
            subtotal: 100,
            tax_amount: 0,
            shipping_cost: 0,
            discount_amount: 0
        }));
        expect(order.total).toBe(100);

        await go(page, `/c/orders/${order.id}/edit`);
        const shipping = page.getByRole("spinbutton", { name: "Shipping" });
        await expect(shipping).toBeVisible({ timeout: 30_000 });
        await shipping.fill("15");
        await page.getByRole("spinbutton", { name: "Discount" }).fill("5");

        const [patch] = await Promise.all([
            page.waitForResponse(res => res.url().includes(`/api/data/orders/${order.id}`) && res.request().method() === "PATCH"),
            page.getByRole("button", { name: "Save", exact: true }).click()
        ]);
        expect(patch.status(), await patch.text()).toBe(200);
        const saved = await fetchRow(request, "orders", order.id);
        expect(saved).toMatchObject({ shipping_cost: 15, discount_amount: 5, total: 110 });

        // And the form shows what the server saved, not what was typed.
        await expect(page.locator("[data-form-field=total]")).toContainText("110", { timeout: 15_000 });
    });

    test("a post's tags can be edited in its form", async ({ page, request }) => {
        // Posts put `tags` (a many-to-many) in the form's rail.
        //
        // KNOWN BUG, reported: `getFormFieldKeys` leaves a many-relation out
        // of the form because the record lists it as a tab — but tags are
        // `hideFromEntityViews`, so there is no tab either, and a post's tags
        // can be edited nowhere. Remove `test.fail` with the fix.
        test.fail();
        const [post] = await fetchRows(request, "posts", "limit=1");
        await go(page, `/c/posts/${post.id}/edit`);
        await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(String(post.title), { timeout: 30_000 });
        await expect(page.locator("[data-form-field=tags]")).toBeVisible({ timeout: 5_000 });
    });
});
