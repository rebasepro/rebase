/**
 * Refuse to test somebody else's app.
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
import type { FullConfig } from "@playwright/test";

const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();

export default async function globalSetup(config: FullConfig) {
    const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:5173";
    // configFile is this directory's playwright.config.ts; rootDir is testDir.
    const e2eDir = config.configFile ? path.dirname(config.configFile) : config.rootDir;
    const indexHtml = path.resolve(e2eDir, "../app/frontend/index.html");

    let served: string;
    try {
        served = await (await fetch(baseURL)).text();
    } catch {
        // Nothing there yet — webServer is about to start ours. Not our problem.
        return;
    }

    const expected = titleOf(fs.readFileSync(indexHtml, "utf8"));
    const actual = titleOf(served);
    if (!expected || actual === expected) return;

    throw new Error(
        `${baseURL} is serving "${actual ?? "an unknown page"}", not the Rebase demo ` +
        `("${expected}").\n\nAnother dev server holds the port, and Playwright reused it ` +
        `instead of starting ours. Stop that server (or free the port) and re-run.`
    );
}
