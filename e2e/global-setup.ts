/**
 * Refuse to test somebody else's app, then sign in once for the whole suite.
 *
 * `webServer.reuseExistingServer` adopts whatever already answers on the port
 * without checking whose it is. Vite hands 5173 to the first project that asks
 * for it, so any other checkout left running takes it, and the suite then
 * drives that app instead — ten tests timing out on a login form that was never
 * ours, which reads as a regression in Rebase.
 *
 * The expected title is read from the app's own index.html rather than pinned
 * here, so renaming the demo cannot turn this guard into a false alarm.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { AUTH_STATE } from "./auth";
import { API_PORT } from "./playwright.config";

const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();

/**
 * Wait for the backend, which `webServer` cannot.
 *
 * `webServer.url` takes a single URL and we point it at Vite, but Vite binds the
 * port whether or not the backend came up — and the backend is a separate
 * process on a separate port that dies independently. Every login then fails
 * with ERR_CONNECTION_REFUSED and ten tests time out on a sidebar link, which
 * reads as an app regression. `/health` is a real check: it round-trips the
 * database.
 */
async function waitForApi(timeoutMs = 90_000) {
    const url = `http://localhost:${API_PORT}/health`;
    const deadline = Date.now() + timeoutMs;
    let last = "never responded";
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok) return;
            last = `HTTP ${res.status}`;
        } catch (err) {
            last = (err as Error).message;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(
        `The backend never became healthy at ${url} (${last}).\n\n` +
        `The frontend can be up while the backend is not — they are separate ` +
        `processes on separate ports — so this is checked before any test runs.`
    );
}

export default async function globalSetup(config: FullConfig) {
    const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:5173";
    // configFile is this directory's playwright.config.ts; rootDir is testDir.
    const e2eDir = config.configFile ? path.dirname(config.configFile) : config.rootDir;
    const indexHtml = path.resolve(e2eDir, "../app/frontend/index.html");

    let served: string | undefined;
    try {
        served = await (await fetch(baseURL)).text();
    } catch {
        // Nothing there yet — webServer is about to start ours. Not our problem.
    }

    if (served !== undefined) {
        const expected = titleOf(fs.readFileSync(indexHtml, "utf8"));
        const actual = titleOf(served);
        if (expected && actual !== expected) {
            throw new Error(
                `${baseURL} is serving "${actual ?? "an unknown page"}", not the Rebase demo ` +
                `("${expected}").\n\nAnother dev server holds the port, and Playwright reused it ` +
                `instead of starting ours. Stop that server (or free the port) and re-run.`
            );
        }
    }

    await waitForApi();
    await signIn(baseURL);
}

/**
 * Sign in once and save the session for the suite to replay.
 *
 * Retried: this is the single login the whole suite depends on, so a lost race
 * here should cost a few seconds, not the run. The failure message has to say
 * that login itself broke — that is the whole point of hoisting it out of the
 * tests, where it could only ever manifest as ten timeouts on a sidebar link.
 */
async function signIn(baseURL: string, attempts = 3) {
    fs.mkdirSync(path.dirname(AUTH_STATE), { recursive: true });
    const browser = await chromium.launch();

    try {
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const context = await browser.newContext({ baseURL });
            const page = await context.newPage();
            try {
                await page.goto("/", { waitUntil: "load" });
                // The demo login pre-fills credentials behind a privacy checkbox,
                // which gates the button — hence check, then click.
                await page.getByRole("checkbox").check();
                await page.getByRole("button", { name: /Sign in with email/i }).click();

                const signIn = page.locator("button", { hasText: /^Sign in$/i }).first();
                await signIn.waitFor({ state: "visible", timeout: 15_000 });
                await signIn.click();

                // The sidebar only renders once the session is live and the
                // collections have loaded, so it is the honest "we are in" signal.
                await page.getByRole("link").filter({ hasText: "Orders" }).first()
                    .waitFor({ state: "visible", timeout: 30_000 });

                await context.storageState({ path: AUTH_STATE });
                await context.close();
                return;
            } catch (err) {
                await context.close();
                if (attempt === attempts) {
                    throw new Error(
                        `Could not sign in to ${baseURL} after ${attempts} attempts — the suite ` +
                        `cannot run signed out.\nLast error: ${(err as Error).message}`
                    );
                }
                await new Promise(r => setTimeout(r, 2000 * attempt));
            }
        }
    } finally {
        await browser.close();
    }
}
