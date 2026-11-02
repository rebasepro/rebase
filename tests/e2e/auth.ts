import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import { API_PORT } from "./playwright.config";

/**
 * The signed-in session, captured once by globalSetup and replayed by every
 * test that needs to be logged in but is not testing logging in.
 *
 * Seven of the ten tests used to drive the whole login sequence in `beforeEach`
 * — checkbox, "Sign in with email", wait for the form, submit, wait for the
 * sidebar — so a single run performed it ten times. Any one of those losing a
 * race failed the *setup*, which fails every test in the file at once and reads
 * as "the e2e is flaky" rather than "login was slow". Doing it once, with
 * retries, means a bad login costs a retry instead of a red suite.
 *
 * `smoke.spec.ts` and `e2e.spec.ts` deliberately do not use this: they are the
 * tests that exercise the login view itself, and must start signed out.
 */
export const AUTH_STATE = path.join(__dirname, ".auth", "user.json");

/**
 * A sign-in of this test's own, for a test that replays `AUTH_STATE`.
 *
 * The demo app keeps its session in an HttpOnly refresh cookie, as a browser
 * app on cookie auth does, and the server swaps that cookie for a new one on
 * every renewal. The cookie saved in `AUTH_STATE` is good once: the first test
 * to load the app renews it, and every later test presented the cookie that had
 * been swapped away, was refused once the server's ten-second reuse window had
 * passed, and sat on the login screen until it timed out.
 *
 * One `POST /api/auth/login` here (no login screen) mints a refresh cookie for
 * this test and puts it in the context before the page loads, over the stale
 * one. Run it from a `beforeEach`, before anything navigates.
 */
export async function freshSession(context: BrowserContext): Promise<void> {
    const url = `http://localhost:${API_PORT}/api/auth/login`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "demo@rebase.pro", password: "DemoRebase2026!" })
    });
    if (!res.ok) throw new Error(`Signing in for this test at ${url} returned HTTP ${res.status}. ${await res.text()}`);
    const cookies = res.headers.getSetCookie().map((header) => {
        const [pair, ...attributes] = header.split(";").map((part) => part.trim());
        const at = pair.indexOf("=");
        const attribute = (name: string) => attributes.find((a) => a.toLowerCase().startsWith(name.toLowerCase()));
        const maxAge = attribute("Max-Age=");
        const sameSite = attribute("SameSite=")?.split("=")[1]?.toLowerCase();
        return {
            name: pair.slice(0, at),
            value: pair.slice(at + 1),
            domain: "localhost",
            path: attribute("Path=")?.split("=")[1] || "/",
            httpOnly: !!attribute("HttpOnly"),
            secure: !!attribute("Secure"),
            sameSite: sameSite === "strict" ? "Strict" as const : sameSite === "none" ? "None" as const : "Lax" as const,
            expires: maxAge ? Math.floor(Date.now() / 1000) + Number(maxAge.split("=")[1]) : -1
        };
    });
    if (!cookies.length) throw new Error(`Signing in for this test at ${url} set no cookie: is the backend's cookieAuth off?`);
    await context.addCookies(cookies);
}
