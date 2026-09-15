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
 * Also guards a kit-level sibling: `MultiSelect` set its height on the same
 * element that draws the field's hairline, so under border-box sizing it stood
 * 2px short of the text fields and selects around it, which set the height on
 * an inner element and draw the border outside it.
 *
 * None of these is visible in the component's own file — each looked correct
 * against the scale it was written for. It only shows when they are rendered
 * next to each other, which is what this measures: one field of each kind a
 * form puts in a column, measured against a text field on the same form.
 */
import { expect, test, type Page } from "@playwright/test";
import { AUTH_STATE } from "../auth";

/** A property key on the form, and the kind of control it renders. */
type Fields = Record<string, string>;

type Measured = { key: string, height: number, fontSize: string };

/**
 * One single-line field per binding, all on the orders form. The multiline
 * address and the customer relation card are taller by design and are not in
 * this list.
 */
const ORDER_FIELDS = {
    order_number: "text",
    tax_amount: "number",
    order_date: "date",
    status: "select",
    subtotal: "read-only"
} as const satisfies Fields;

/** The orders form has no multi-value field; products has `available_locales`. */
const PRODUCT_FIELDS = {
    name: "text",
    status: "select",
    available_locales: "multi-select"
} as const satisfies Fields;

/** Opens the create form of the collection behind the nav link `linkName`. */
async function openCreateForm(page: Page, linkName: RegExp, path: RegExp, fields: Fields) {
    await page.goto("/");

    const link = page.getByRole("link", { name: linkName }).first();
    await expect(link).toBeVisible({ timeout: 30000 });
    await link.click();
    await expect(page).toHaveURL(path);

    await page.getByRole("button", { name: /Add/i }).first().click();
    for (const key of Object.keys(fields)) {
        await expect(page.locator(`#form_field_${key}`)).toBeVisible({ timeout: 15000 });
    }
}

/**
 * The control box of each field. `FieldBlock` wraps a field as
 * `#form_field_<key>`: the label, then a slot holding what the binding
 * rendered, then the description. The control box is the slot's first child.
 */
async function measureFields(page: Page, fields: Fields): Promise<Measured[]> {
    return page.evaluate((keys: string[]) => keys.map(key => {
        const field = document.getElementById(`form_field_${key}`);
        const box = field?.querySelector(":scope > .min-w-0")?.firstElementChild;
        if (!box) return { key, height: -1, fontSize: "" };
        const text = box.querySelector("input") ?? box;
        return {
            key,
            height: box.getBoundingClientRect().height,
            fontSize: getComputedStyle(text).fontSize
        };
    }), Object.keys(fields));
}

/** Asserts every field is the height of the text field `referenceKey`. */
function expectOneHeight(measured: Measured[], fields: Fields, referenceKey: string) {
    const reference = measured.find(m => m.key === referenceKey);
    expect(reference?.height ?? -1, "the text field's control box was not found").toBeGreaterThan(0);

    const describe = measured
        .map(m => `  ${m.key} (${fields[m.key]}): ${m.height}px, ${m.fontSize}`)
        .join("\n");

    for (const m of measured) {
        expect(
            m.height,
            `${m.key} (${fields[m.key]}) is not the text field's height — ` +
            `its control or its binding is off the form's \`size\`:\n${describe}`
        ).toBe(reference?.height);
    }
    return describe;
}

test.describe("entity form controls", () => {
    test.use({ storageState: AUTH_STATE });

    test("every single-line control is one height, and a read-only value is input-sized", async ({ page }) => {
        await openCreateForm(page, /Orders/i, /\/c\/orders/, ORDER_FIELDS);
        const measured = await measureFields(page, ORDER_FIELDS);
        const describe = expectOneHeight(measured, ORDER_FIELDS, "order_number");

        const byKey = Object.fromEntries(measured.map(m => [m.key, m]));
        expect(
            byKey.subtotal.fontSize,
            `the read-only value is not printed at the inputs' text size:\n${describe}`
        ).toBe(byKey.order_number.fontSize);
    });

    test("a multi-select is the height of the text field and the select beside it", async ({ page }) => {
        await openCreateForm(page, /Products/i, /\/c\/products/, PRODUCT_FIELDS);
        const measured = await measureFields(page, PRODUCT_FIELDS);
        expectOneHeight(measured, PRODUCT_FIELDS, "name");
    });
});
