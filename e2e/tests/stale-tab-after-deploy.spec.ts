import { expect, test, type Route } from "@playwright/test";
import { AUTH_STATE } from "../auth";

/**
 * A tab that outlived a deploy.
 *
 * Every view behind a lazy import is fetched by content hash, and a deploy
 * replaces the whole `assets/` directory. A tab opened before it still holds
 * the previous entry chunk, so the first lazy view the user opens asks for a
 * hash the server no longer has — and if the server answers missing assets with
 * its SPA fallback, what comes back is index.html under a .js URL, which the
 * browser refuses as a module.
 *
 * Nothing in the rest of the suite can produce this: Playwright loads one build
 * and never replaces it underneath the page. It has to be staged, and this is
 * the staging — the response the browser would get from a server that has moved
 * on. Reported from production as "Failed to fetch dynamically imported module:
 * .../RouterCollectionsStudioView-<hash>.js" on opening the schema view.
 */
test.use({ storageState: AUTH_STATE });

const STUDIO_CHUNK = /CollectionsStudioView/;

test.describe("a tab left open across a deploy", () => {

    test("offers a reload when a lazy view's chunk is gone", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("link").filter({ hasText: "Orders" }).first())
            .toBeVisible({ timeout: 30000 });

        // The deploy. From here the chunk this build asks for no longer exists,
        // and the server hands back the index instead — a 200 of HTML.
        const indexHtml = await page.evaluate(() => document.documentElement.outerHTML);
        let servedStaleIndex = 0;
        await page.route(STUDIO_CHUNK, async (route: Route) => {
            servedStaleIndex++;
            await route.fulfill({
                status: 200,
                contentType: "text/html; charset=utf-8",
                body: indexHtml
            });
        });

        await page.goto("/schema");

        // Not the browser's wording, which names a filename and reads as a
        // broken build. The user is told what happened and what fixes it.
        await expect(page.getByText("New version available")).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole("button", { name: /reload/i })).toBeVisible();
        await expect(page.getByText(/dynamically imported module/i)).toHaveCount(0);

        // Without this the test passes when the interception never applied —
        // the failure it guards would be staged, asserted, and absent.
        expect(servedStaleIndex).toBeGreaterThan(0);
    });

    test("the reload recovers, since the fresh index points at chunks that exist", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("link").filter({ hasText: "Orders" }).first())
            .toBeVisible({ timeout: 30000 });

        const indexHtml = await page.evaluate(() => document.documentElement.outerHTML);
        await page.route(STUDIO_CHUNK, async (route: Route) => {
            await route.fulfill({ status: 200,
contentType: "text/html; charset=utf-8",
body: indexHtml });
        });

        await page.goto("/schema");
        await expect(page.getByText("New version available")).toBeVisible({ timeout: 30000 });

        // The reload is only useful if the tab then picks up the current build.
        await page.unroute(STUDIO_CHUNK);
        await page.getByRole("button", { name: /reload/i }).click();

        await expect(page.getByText("New version available")).toHaveCount(0, { timeout: 30000 });
    });
});
