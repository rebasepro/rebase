/**
 * The record dialog — the users collection's "Add user" — as a keyboard and a
 * pointer find it.
 *
 * Guards four defects reported together against that dialog:
 *
 *  - Tab from a field did not reach the next field. Leaving a field closed the
 *    "Property ID" tooltip it had opened on focus, and removing that tooltip
 *    from inside the dialog while focus was in flight made Radix's focus trap
 *    conclude the focused element had been deleted: it focused the dialog
 *    itself, the browser abandoned the move, and the next Tab started again
 *    from the header. Any node removed during a focus move does it, so the test
 *    removes one directly instead of depending on which control still has a
 *    tooltip — the fix is in the kit's `Dialog`, not in that tooltip.
 *  - That tooltip also sat over the label of the field being filled in. The
 *    key is now revealed inline, in the label row, and covers nothing.
 *  - A three-field form was split into two columns.
 *  - Create and "Create and close" were in the top bar instead of the footer.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AUTH_STATE } from "../auth";

async function openNewUser(page: Page): Promise<Locator> {
    await page.goto("/c/users");
    await page.getByRole("button", { name: /Add User/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#form_field_email input")).toBeVisible({ timeout: 15000 });
    return dialog;
}

test.describe("entity dialog", () => {
    test.use({ storageState: AUTH_STATE });

    test("Tab and Shift+Tab move field to field when something unmounts on the way", async ({ page }) => {
        const dialog = await openNewUser(page);
        const email = dialog.locator("#form_field_email input");
        const name = dialog.locator("#form_field_displayName input");

        // What the tooltip did: take a node out of the dialog in response to
        // the field losing focus, while the browser is between the two fields.
        const armRemovalOnBlur = (selector: string) => page.evaluate((fieldSelector) => {
            const dialogEl = document.querySelector("[role=dialog]");
            const field = dialogEl?.querySelector(fieldSelector);
            if (!dialogEl || !field) throw new Error(`no ${fieldSelector} in the dialog`);
            const probe = document.createElement("div");
            dialogEl.appendChild(probe);
            field.addEventListener("focusout", () => probe.remove(), { once: true });
        }, selector);

        await email.focus();
        await armRemovalOnBlur("#form_field_email input");
        await page.keyboard.press("Tab");
        await expect(name, "Tab from Email did not reach Name").toBeFocused();

        await armRemovalOnBlur("#form_field_displayName input");
        await page.keyboard.press("Shift+Tab");
        await expect(email, "Shift+Tab from Name did not return to Email").toBeFocused();
    });

    test("focusing a field opens nothing over the form", async ({ page }) => {
        const dialog = await openNewUser(page);
        await dialog.locator("#form_field_email input").focus();
        await page.keyboard.press("Tab");
        await expect(page.locator("[data-radix-popper-content-wrapper]")).toHaveCount(0);
    });

    test("hovering a label reveals its key in the label row, clear of the field", async ({ page }) => {
        const dialog = await openNewUser(page);
        const block = dialog.locator("#form_field_displayName");
        const hint = block.getByRole("button", { name: "Copy displayName" });

        await expect(hint).toHaveCSS("opacity", "0");
        await block.getByText("Name", { exact: true }).hover();
        await expect(hint).toHaveCSS("opacity", "1");

        const hintBox = await hint.boundingBox();
        const inputBox = await block.locator("input").boundingBox();
        expect(hintBox && inputBox, "hint or input not laid out").toBeTruthy();
        expect(hintBox!.y + hintBox!.height, "the key overlaps the field below its label")
            .toBeLessThanOrEqual(inputBox!.y);
        await expect(page.locator("[data-radix-popper-content-wrapper]")).toHaveCount(0);
    });

    test("a short form is one column", async ({ page }) => {
        const dialog = await openNewUser(page);
        // Every field, not a chosen pair: the demo titles users by name, which
        // already gives Name a row of its own, and the pair that used to split
        // was further down.
        const blocks = dialog.locator("[id^=form_field_]");
        await expect(blocks.first()).toBeVisible();
        const boxes = await blocks.evaluateAll(elements => elements.map(el => {
            const r = el.getBoundingClientRect();
            return { id: el.id, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) };
        }));
        expect(boxes.length, "expected the users form to have several fields").toBeGreaterThan(2);
        const describe = boxes.map(b => `  ${b.id}: x=${b.x} y=${b.y} w=${b.width}`).join("\n");
        for (const [index, box] of boxes.entries()) {
            expect(box.x, `not one column:\n${describe}`).toBe(boxes[0].x);
            expect(box.width, `not one column:\n${describe}`).toBe(boxes[0].width);
            if (index > 0) expect(box.y, `two fields share a row:\n${describe}`).toBeGreaterThan(boxes[index - 1].y);
        }
    });

    test("Create and Create and close sit at the foot of the dialog, under the form", async ({ page }) => {
        const dialog = await openNewUser(page);
        const createAndClose = dialog.getByRole("button", { name: "Create and close" });
        const create = dialog.getByRole("button", { name: "Create", exact: true });
        await expect(createAndClose).toBeVisible();
        await expect(create).toBeVisible();

        const lastField = await dialog.locator("[id^=form_field_]").last().boundingBox();
        const button = await createAndClose.boundingBox();
        expect(lastField && button, "not laid out").toBeTruthy();
        expect(button!.y, "the actions are above the form").toBeGreaterThan(lastField!.y + lastField!.height);

        // One of each: moving them must not leave a second copy in the bar.
        await expect(dialog.getByRole("button", { name: "Create and close" })).toHaveCount(1);
    });
});
