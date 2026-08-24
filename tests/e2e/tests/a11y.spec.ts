/**
 * Accessible names must survive, on the three screens where they were broken.
 *
 * Guards the fix for the 2026-08-09 DX audit findings: a login form named after
 * its own placeholders (the password field announced as eight bullets), entity
 * form fields named after their own value, and an icon-only nav rail whose links
 * had no name at all when collapsed.
 *
 * Both viewport widths are exercised deliberately: the rail renders its labels
 * with `display:none` when collapsed, so it is *only* broken below the layout
 * breakpoint and a single-width run would miss it entirely.
 *
 * See e2e/a11y.ts for why this does not use axe-core — in short, axe accepts a
 * placeholder as an accessible name, so it would pass the exact bug this guards.
 *
 * ## What this does NOT cover
 *
 * Form fields and links only. Icon-only <button>s are still unnamed in several
 * places (see the `ControlFamily` docs in e2e/a11y.ts for the current counts) and
 * asserting on them here would make this red for a defect class nobody is fixing
 * in this change — which is how a guard ends up skipped, protecting nothing.
 * Widening it to `["field", "link", "button"]` is a deliberate next step, not a
 * one-line tidy-up.
 */
import { expect, test } from "@playwright/test";
import { AUTH_STATE } from "../auth";
import {
    describeNamelessControls,
    findNamelessControls,
    RAIL_COLLAPSED,
    RAIL_EXPANDED
} from "../a11y";

const WIDTHS = [
    {
        name: "rail collapsed (1280px)",
        viewport: RAIL_COLLAPSED
    },
    {
        name: "rail expanded (1440px)",
        viewport: RAIL_EXPANDED
    }
];

for (const { name, viewport } of WIDTHS) {

    test.describe(`accessible names — ${name}`, () => {

        test.describe("signed out", () => {
            test.use({ viewport });

            test("the login screen names every field and control", async ({ page }) => {
                await page.goto("/");

                // The privacy checkbox, which is what gates the sign-in button.
                // `getByRole("checkbox")` was unambiguous until the newsletter opt-in moved
                // onto this screen — it now resolves to two elements and Playwright's strict
                // mode refuses. Privacy comes from the host's `topComponent`, which renders
                // above the newsletter row, so it is the first one.
                await page.getByRole("checkbox").first().check();
                await page.getByRole("button", { name: /Sign in with email/i }).click();

                // The form is up once the password field exists.
                await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15000 });

                const found = await findNamelessControls(page);
                expect(found, describeNamelessControls(found, `the login screen at ${name}`)).toEqual([]);

                // The specific regression, asserted by name rather than by count:
                // these two must resolve to real labels, not to their placeholders.
                await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
                await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
            });
        });

        test.describe("signed in", () => {
            test.use({
                viewport,
                storageState: AUTH_STATE
            });

            test("the collection list names every field and control", async ({ page }) => {
                await page.goto("/");

                const ordersLink = page.getByRole("link", { name: /Orders/i }).first();
                await expect(ordersLink).toBeVisible({ timeout: 30000 });
                await ordersLink.click();
                await expect(page).toHaveURL(/\/c\/orders/);
                await expect(page.getByRole("button", { name: /Add/i }).first())
                    .toBeVisible({ timeout: 15000 });

                const found = await findNamelessControls(page);
                expect(found, describeNamelessControls(found, `the collection list at ${name}`)).toEqual([]);
            });

            test("the nav rail links are reachable by name", async ({ page }) => {
                await page.goto("/");
                // Collapsed, the label is display:none — so this passes only if the
                // link carries an aria-label of its own.
                await expect(page.getByRole("link", { name: /Orders/i }).first())
                    .toBeVisible({ timeout: 30000 });
                await expect(page.getByRole("link", { name: /Products/i }).first()).toBeVisible();
                // The brand link, which is icon-only at every width.
                await expect(page.getByRole("link", { name: /^Home$/i }).first()).toBeVisible();
            });

            test("the entity form names every field and control", async ({ page }) => {
                await page.goto("/");

                const ordersLink = page.getByRole("link", { name: /Orders/i }).first();
                await expect(ordersLink).toBeVisible({ timeout: 30000 });
                await ordersLink.click();
                await expect(page).toHaveURL(/\/c\/orders/);

                // Open the create form — the entity form with every field empty,
                // which is also the state where the relation pickers used to show
                // a bare grey pill.
                await page.getByRole("button", { name: /Add/i }).first().click();

                // The form is up once a text input inside it is present.
                await expect(page.locator('input[type="text"], textarea').first())
                    .toBeVisible({ timeout: 15000 });

                const found = await findNamelessControls(page);
                expect(found, describeNamelessControls(found, `the entity form at ${name}`)).toEqual([]);
            });
        });
    });
}
