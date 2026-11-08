/**
 * The `test` the admin-flow specs (`admin-*.spec.ts`) run on: one signed-in
 * page for the whole worker, moved between screens the way the app moves
 * itself, without a reload.
 *
 * ── Why one page, not one per test ──────────────────────────────────────
 *
 * The server allows 200 requests per IP per 15 minutes on its auth limiter,
 * and that budget is shared by `POST /auth/login` and `GET /auth/config` —
 * which the app calls twice on every page load. The rest of this suite
 * already spends about 115 of it in one run, with the usual
 * one-sign-in-per-test (`freshSession`) and a `page.goto` per screen. Done the
 * same way, these specs would take the run past 200, and then every sign-in
 * and every page load answers 429 — which reads as the admin being broken.
 *
 * So these specs sign in once per worker, and `go()` changes screens through
 * the router's own history (a `pushState` and a `popstate`, which is what a
 * link does), not by loading the page again. A test that is *about* a
 * reload still reloads.
 *
 * The page runs in New York, in English, so a date that slips through as UTC
 * anywhere shows up as an hours-long shift, and formatted numbers and dates
 * read the same on every machine.
 */
import { test as base, devices, expect, type BrowserContext, type ConsoleMessage, type Page, type Response } from "@playwright/test";
import { AUTH_STATE, freshSession } from "../auth";
import { PORT } from "../playwright.config";

export { expect };

const BASE_URL = `http://localhost:${PORT}`;
const VIEWPORT = devices["Desktop Chrome"].viewport;

/**
 * Fails the running test on a console error or a 4xx/5xx from the API, as
 * `failOnPageErrors` does — but returns how to stop, because the page outlives
 * the test and the next one must not inherit this one's listeners.
 */
function watchForErrors(page: Page): () => void {
    const onConsole = (msg: ConsoleMessage) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (
            text.includes("ERR_CONNECTION_REFUSED") ||
            text.includes("Failed to load resource") ||
            text.includes("WebSocket error")
        ) {
            return;
        }
        throw new Error(`Console error: ${text}`);
    };
    const onResponse = (response: Response) => {
        if (response.url().includes("/api/") && response.status() >= 400) {
            throw new Error(`API Request failed: ${response.url()} returned status ${response.status()}`);
        }
    };
    page.on("console", onConsole);
    page.on("response", onResponse);
    return () => {
        page.off("console", onConsole);
        page.off("response", onResponse);
    };
}

export const test = base.extend<object, { adminContext: BrowserContext; adminPage: Page }>({
    adminContext: [async ({ browser }, provide) => {
        const context = await browser.newContext({
            ...devices["Desktop Chrome"],
            baseURL: BASE_URL,
            storageState: AUTH_STATE,
            timezoneId: "America/New_York",
            locale: "en-US"
        });
        await freshSession(context);
        await provide(context);
        await context.close();
    }, { scope: "worker" }],

    adminPage: [async ({ adminContext }, provide) => {
        const page = await adminContext.newPage();
        // A form left with unsaved edits asks before the page unloads; the
        // reset below must not wait on that question.
        page.on("dialog", dialog => void dialog.accept());
        await provide(page);
    }, { scope: "worker" }],

    page: async ({ adminPage }, provide, testInfo) => {
        const page = adminPage;
        await page.setViewportSize(VIEWPORT);
        const stopWatching = watchForErrors(page);
        // Each test starts on the home page, with nothing open over it.
        await go(page, "/");
        await expect(page.getByRole("link", { name: "Orders" }).first()).toBeVisible({ timeout: 30_000 });
        await provide(page);
        stopWatching();
        // A test that did not pass may have left anything behind — a dirty
        // form, an open dialog — so the next one loads the app afresh. Also
        // after a `test.fail()` test, whose failure does not restart the worker.
        if (testInfo.status !== "passed") await page.goto("about:blank");
    }
});

/**
 * Shows `path` (with its query and hash) the way a link in the app does.
 *
 * The first call loads the app. After that the URL is pushed onto the
 * router's history and a `popstate` tells the router to read it — the state
 * object is React Router's own (`{ usr, key, idx }`), so it treats this as an
 * ordinary navigation. Whatever was open over the last screen (a menu, a
 * dialog) is closed first, as it would be by the click on a link.
 */
export async function go(page: Page, path: string): Promise<void> {
    const appIsUp = page.url().startsWith(BASE_URL) &&
        await page.getByRole("navigation", { name: "Main navigation" }).isVisible();
    if (!appIsUp) {
        await page.goto(path);
        return;
    }
    await page.keyboard.press("Escape");
    await page.evaluate((target) => {
        const current = window.history.state as { idx?: number } | null;
        const state = { usr: null, key: Math.random().toString(36).slice(2, 10), idx: (current?.idx ?? 0) + 1 };
        window.history.pushState(state, "", target);
        window.dispatchEvent(new PopStateEvent("popstate", { state }));
    }, path);
}
