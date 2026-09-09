/**
 * Tabbing through the panel must show a whole focus ring, not three quarters of
 * one.
 *
 * Guards the fix for the reported defect: every row of the drawer rail drew a
 * ring with sides missing, because the navigation group that holds them clips
 * (`overflow-hidden`) for its collapse animation and the rows run full-bleed
 * inside it. The same shape appeared on the first and last chip of the
 * filter-preset scroller and on the tabs of a scrolling tab strip — three
 * components, one cause: paint outside the border box, an ancestor that clips.
 *
 * The fix was to draw the ring *inside* the box, so there is nothing outside to
 * cut. Both properties are asserted, and they are not the same assertion: a
 * whole ring can also happen because no ancestor clips today, which passes the
 * geometry check and regresses the moment somebody adds a scroller.
 *
 * See e2e/focus-ring.ts for why this walks the real tab order and why it waits
 * between stops.
 */
import { expect, test } from "@playwright/test";
import { AUTH_STATE } from "../auth";
import {
    describeClippedFocusRings,
    findClippedFocusRings,
    focusedRingIsInset
} from "../focus-ring";

test.describe("focus rings", () => {
    test.use({ storageState: AUTH_STATE });

    test("the drawer rail draws whole rings", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("link", { name: /Products/i }).first())
            .toBeVisible({ timeout: 30000 });

        const found = await findClippedFocusRings(page);
        expect(found, describeClippedFocusRings(found, "the drawer rail")).toEqual([]);
    });

    test("a drawer row's ring is drawn inside its own box", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("link", { name: /Products/i }).first())
            .toBeVisible({ timeout: 30000 });

        // Reached with the keyboard, because `:focus-visible` — the selector
        // that draws the ring — does not reliably match a programmatic focus.
        let reached = false;
        for (let i = 0; i < 40 && !reached; i++) {
            await page.keyboard.press("Tab");
            reached = await page.evaluate(
                () => document.activeElement?.getAttribute("aria-label") === "Products"
            );
        }
        expect(reached, "never tabbed onto the Products row").toBe(true);

        expect(
            await focusedRingIsInset(page),
            "the Products row's focus ring is painted outside its box, so the " +
            "navigation group's overflow-hidden will cut it"
        ).toBe(true);
    });

    test("the collection list draws whole rings", async ({ page }) => {
        await page.goto("/");

        const products = page.getByRole("link", { name: /Products/i }).first();
        await expect(products).toBeVisible({ timeout: 30000 });
        await products.click();
        await expect(page).toHaveURL(/\/c\/products/);
        // The toolbar is up once its search field is: that row holds the filter
        // presets, whose horizontal scroller clipped the first and last chip.
        await expect(page.getByRole("search").first()).toBeVisible({ timeout: 15000 });

        const found = await findClippedFocusRings(page);
        expect(found, describeClippedFocusRings(found, "the collection list")).toEqual([]);
    });
});
