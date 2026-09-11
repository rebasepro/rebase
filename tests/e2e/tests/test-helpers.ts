import fs from "node:fs";
import type { Page } from "@playwright/test";
import { AUTH_STATE } from "../auth";
import { API_PORT } from "../playwright.config";

/**
 * A Bearer token for the tests that talk to the API directly.
 *
 * The browser tests replay `AUTH_STATE`; the BaaS ones have no browser, so they
 * need the token out of it. Read from the same file rather than signing in
 * again: a second login is a second session, and the one thing worse than a
 * suite that cannot authenticate is a suite authenticating as somebody the
 * other half of it is not.
 *
 * The fallback exists for the case the storage state is missing or unreadable —
 * and it throws rather than returning an empty string. Handing back "" makes
 * every caller fail as `expected 201, got 401`, which reads as a broken write
 * route; the authentication is what broke, and the message has to say so.
 */
let cachedToken: string | null = null;

interface StoredAuthState {
    readonly origins?: readonly {
        readonly localStorage?: readonly { readonly name: string; readonly value: string }[];
    }[];
}

interface LoginResponseBody {
    readonly accessToken?: string;
}

function tokenFromStorageState(): string | undefined {
    if (!fs.existsSync(AUTH_STATE)) return undefined;
    try {
        const parsed = JSON.parse(fs.readFileSync(AUTH_STATE, "utf8")) as StoredAuthState;
        for (const origin of parsed.origins ?? []) {
            for (const item of origin.localStorage ?? []) {
                if (item.name !== "rebase_auth") continue;
                const { accessToken } = JSON.parse(item.value) as LoginResponseBody;
                if (accessToken) return accessToken;
            }
        }
    } catch {
        return undefined; // Malformed: fall through to a real sign-in.
    }
    return undefined;
}

export async function getAuthToken(): Promise<string> {
    if (cachedToken) return cachedToken;

    const stored = tokenFromStorageState();
    if (stored) {
        cachedToken = stored;
        return stored;
    }

    // `/api/auth/login`, not `/auth/login`: the auth router is mounted under the
    // server's `basePath`, which defaults to `/api`. The bare path 404s, and a
    // 404 here is indistinguishable from a wrong password unless you look.
    const url = `${getApiBaseUrl()}/api/auth/login`;
    let res: Response;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "demo@rebase.pro", password: "DemoRebase2026!" })
        });
    } catch (err) {
        throw new Error(`Could not reach ${url} to sign in: ${(err as Error).message}`);
    }
    if (!res.ok) {
        throw new Error(`Signing in at ${url} returned HTTP ${res.status}. ${await res.text()}`);
    }

    const { accessToken } = (await res.json()) as LoginResponseBody;
    if (!accessToken) {
        throw new Error(`Sign-in at ${url} succeeded but returned no accessToken.`);
    }
    cachedToken = accessToken;
    return accessToken;
}

/** Common headers for an authenticated Data API request. */
export async function getAuthHeaders(): Promise<Record<string, string>> {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await getAuthToken()}`
    };
}

export function getApiBaseUrl(): string {
    return `http://localhost:${API_PORT}`;
}

/**
 * Fail the test on a console error or a 4xx/5xx from the API.
 *
 * Both listeners throw, which does fail the test — Playwright surfaces an
 * exception from an event handler as the test's error. The three ignored
 * strings are the noise a dev server makes while it is still coming up, not
 * failures of the page under test.
 *
 * Shared because the browser specs each want exactly this and a copy per file
 * is a filter list that drifts: the day a fourth benign message appears, it has
 * to be added everywhere or the file that missed it goes red on its own.
 */
export function failOnPageErrors(page: Page): void {
    page.on("console", msg => {
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
    });

    page.on("response", response => {
        if (response.url().includes("/api/") && response.status() >= 400) {
            throw new Error(`API Request failed: ${response.url()} returned status ${response.status()}`);
        }
    });
}
