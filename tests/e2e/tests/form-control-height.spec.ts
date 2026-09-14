/**
 * Every single-line control in the entity form stands at one height, and a
 * read-only value is printed at the size of the inputs beside it.
 *
 * Guards the fix for the reported defect. The form moved its controls to
 * `small` (32px, 14px text) by passing `size` to every field binding, and two
 * bindings did not follow: the date field never forwarded `size`, so it drew
 * at the kit's `large` default, and the read-only box had a fixed 48px height
 * and inherited the page's 16px text. One column of a form held three heights
 * and two text sizes, and a read-only date printed its value a size up from
 * the editable date directly above it.
 *
 * Neither is visible in the binding's own file — each looked correct against
 * the scale it was written for. It only shows when they are rendered next to
 * each other, which is what this measures: one field of each kind the orders
 * form puts in a column, measured against the text field.
 */
import { expect, test } from "@playwright/test";
import { AUTH_STATE } from "../auth";

/**
 * One single-line field per binding, all on the orders form. The multiline
 * address and the customer relation card are taller by design and are not in
 * this list.
 */
const FIELDS = {
    order_number: "text",
    tax_amount: "number",
    order_date: "date",
    status: "select",
    subtotal: "read-only"
} as const;

type FieldKey = keyof typeof FIELDS;

test.describe("entity form controls", () => {
    test.use({ storageState: AUTH_STATE });

    test("every single-line control is one height, and a read-only value is input-sized", async ({ page }) => {
        await page.goto("/");

        const ordersLink = page.getByRole("link", { name: /Orders/i }).first();
        await expect(ordersLink).toBeVisible({ timeout: 30000 });
        await ordersLink.click();
        await expect(page).toHaveURL(/\/c\/orders/);

        await page.getByRole("button", { name: /Add/i }).first().click();
        for (const key of Object.keys(FIELDS)) {
            await expect(page.locator(`#form_field_${key}`)).toBeVisible({ timeout: 15000 });
        }

        // `FieldBlock` wraps each field as `#form_field_<key>`: the label, then
        // a slot holding what the binding rendered, then the description. The
        // control box is the slot's first child.
        const measured = await page.evaluate((keys: string[]) => keys.map(key => {
            const field = document.getElementById(`form_field_${key}`);
            const box = field?.querySelector(":scope > .min-w-0")?.firstElementChild;
            if (!box) return { key, height: -1, fontSize: "" };
            const text = box.querySelector("input") ?? box;
            return {
                key,
                height: box.getBoundingClientRect().height,
                fontSize: getComputedStyle(text).fontSize
            };
        }), Object.keys(FIELDS));

        const byKey = Object.fromEntries(measured.map(m => [m.key, m])) as Record<FieldKey, typeof measured[number]>;
        const reference = byKey.order_number;
        expect(reference.height, "the text field's control box was not found").toBeGreaterThan(0);

        const describe = measured
            .map(m => `  ${m.key} (${FIELDS[m.key as FieldKey]}): ${m.height}px, ${m.fontSize}`)
            .join("\n");

        for (const m of measured) {
            expect(
                m.height,
                `${m.key} (${FIELDS[m.key as FieldKey]}) is not the text field's height — ` +
                `a field binding is ignoring the form's \`size\`:\n${describe}`
            ).toBe(reference.height);
        }

        expect(
            byKey.subtotal.fontSize,
            `the read-only value is not printed at the inputs' text size:\n${describe}`
        ).toBe(reference.fontSize);
    });
});
