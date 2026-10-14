import { afterEach, describe, expect, it } from "@jest/globals";
import type { AuthChangeEvent } from "@rebasepro/types";
import { createMemoryStorage, createRebaseClient, type AuthStorage } from "../src/index";

/**
 * A cookie-mode browser that holds no session stops asking for one.
 *
 * In cookie mode the refresh token is an HttpOnly cookie the page cannot read,
 * so the client restores a session on load by asking the server
 * (`POST /auth/refresh`). For a visitor who never signed in, the answer is
 * always `401 NO_SESSION`: the request carried no cookie at all. The client
 * asked anyway, on every load, and each answer was an error in the browser's
 * console and a line in the backend's log — two or three per anonymous page
 * view, one per client the page built.
 *
 * Once the server has said this browser presents no refresh cookie, or the user
 * has signed out here, the client remembers it (in its auth storage, beside
 * where JSON mode keeps its session) and the next load restores nothing
 * without asking. Any session it adopts clears that, so a sign-in — in this
 * tab or another — brings the restore back. A refusal of a token that *was*
 * presented (`INVALID_TOKEN`) is not remembered: a sibling tab may hold the
 * live cookie, and the next load has to ask.
 */

const HOUR = 3_600_000;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

const user = { uid: "u1", email: "u1@example.com", displayName: "U1" };

/**
 * A backend in cookie mode and the browser's cookie jar in front of it. The jar
 * holds the refresh cookie or not; a page load is a new client over the same
 * jar and the same storage, as in one browser.
 */
function createBrowser() {
    const browser = {
        /** Whether the jar holds a refresh cookie, and whether the server knows it. */
        cookie: "none" as "none" | "live" | "unknown-to-server",
        refreshGate: undefined as Promise<void> | undefined,
        storage: createMemoryStorage() as AuthStorage,
        paths: [] as string[]
    };
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = url.replace("http://api.test/api", "");
        const headers = (init?.headers ?? {}) as Record<string, string>;
        browser.paths.push(path);
        const session = () => json({
            tokens: { accessToken: "a-live", refreshToken: "", accessTokenExpiresAt: Date.now() + HOUR },
            user
        });
        if (path === "/auth/refresh") {
            // What the request carried was decided when it was sent.
            const carried = browser.cookie;
            await browser.refreshGate;
            if (carried === "none") return json({ error: { code: "NO_SESSION", message: "No refresh token presented" } }, 401);
            if (carried === "unknown-to-server") return json({ error: { code: "INVALID_TOKEN", message: "Invalid refresh token" } }, 401);
            return session();
        }
        if (path === "/auth/login") {
            browser.cookie = "live";
            return session();
        }
        if (path === "/auth/logout") {
            browser.cookie = "none";
            return json({ success: true });
        }
        if (path === "/auth/me") return json({ user });
        if (path.startsWith("/data/")) {
            return headers.Authorization === "Bearer a-live"
                ? json({ data: [{ id: "mine" }], meta: { total: 1, hasMore: false } })
                : json({ error: { code: "TOKEN_EXPIRED", message: "expired" } }, 401);
        }
        return json({ error: { code: "NOT_FOUND", message: path } }, 404);
    }) as typeof fetch;

    const clients: { close: () => void }[] = [];
    return {
        browser,
        /** A page load: a new client, in this browser. */
        load() {
            const client = createRebaseClient({
                baseUrl: "http://api.test",
                realtime: false,
                fetch: fetchFn,
                auth: { authFlowMode: "cookie", storage: browser.storage }
            });
            clients.push(client);
            return client;
        },
        refreshes: () => browser.paths.filter((p) => p === "/auth/refresh").length,
        close: () => clients.splice(0).forEach((c) => c.close())
    };
}

const browsers: { close: () => void }[] = [];
function browser() {
    const b = createBrowser();
    browsers.push(b);
    return b;
}
afterEach(() => {
    browsers.splice(0).forEach((b) => b.close());
});

describe("a cookie-mode visitor who never signed in", () => {
    it("is asked about once, then not on the next load", async () => {
        const b = browser();

        const first = b.load();
        await first.auth.isInitialized();
        expect(first.auth.restoreOutcome()).toBe("none");
        expect(b.refreshes()).toBe(1);

        const second = b.load();
        await second.auth.isInitialized();
        expect(second.auth.getSession()).toBeNull();
        expect(second.auth.restoreOutcome()).toBe("none");
        expect(b.refreshes()).toBe(1);
    });

    it("is not asked about again after signing out here", async () => {
        const b = browser();
        const first = b.load();
        await first.auth.isInitialized();
        await first.auth.signInWithEmail("u1@example.com", "pw");
        await first.auth.signOut();
        const before = b.refreshes();

        const second = b.load();
        await second.auth.isInitialized();
        expect(second.auth.getSession()).toBeNull();
        expect(b.refreshes()).toBe(before);
    });
});

describe("a cookie-mode session", () => {
    it("is restored on the next load after a sign-in", async () => {
        const b = browser();
        const first = b.load();
        await first.auth.isInitialized();
        await first.auth.signInWithEmail("u1@example.com", "pw");

        const second = b.load();
        await second.auth.isInitialized();
        expect(second.auth.restoreOutcome()).toBe("restored");
        expect(second.auth.getSession()?.user.uid).toBe("u1");
    });

    it("is restored when the browser has never been told either way", async () => {
        // A cookie from before this client remembered anything, or storage
        // cleared while the cookie stayed: the client has to ask.
        const b = browser();
        b.browser.cookie = "live";

        const page = b.load();
        await page.auth.isInitialized();
        expect(page.auth.restoreOutcome()).toBe("restored");
        expect(b.refreshes()).toBe(1);
    });

    it("signed in by another tab while this one was asking is restored on the next load", async () => {
        const b = browser();
        const gate = deferred();
        b.browser.refreshGate = gate.promise;

        // This tab's restore goes out with no cookie, and waits.
        const asking = b.load();
        // Another tab signs in meanwhile.
        b.browser.refreshGate = undefined;
        const other = b.load();
        await other.auth.isInitialized();
        await other.auth.signInWithEmail("u1@example.com", "pw");
        // The first tab's answer, NO_SESSION, lands after the sign-in.
        gate.resolve();
        await asking.auth.isInitialized();

        const next = b.load();
        await next.auth.isInitialized();
        expect(next.auth.restoreOutcome()).toBe("restored");
    });

    it("still refreshes an access token that has expired", async () => {
        const b = browser();
        b.browser.cookie = "live";
        const page = b.load();
        await page.auth.isInitialized();
        const before = b.refreshes();

        await expect(page.auth.refreshSession()).resolves.toMatchObject({ accessToken: "a-live" });
        expect(b.refreshes()).toBe(before + 1);
    });

    it("is signed out when its refresh is refused, and the next load still asks", async () => {
        const b = browser();
        b.browser.cookie = "live";
        const page = b.load();
        await page.auth.isInitialized();
        const events: AuthChangeEvent[] = [];
        page.auth.onAuthStateChange((event) => { events.push(event); });

        // The server no longer recognises the cookie, and the access token
        // is refused: the request's 401 refreshes, the refresh is refused.
        b.browser.cookie = "unknown-to-server";
        page.setToken("a-stale");
        await expect(page.data.collection("posts").find({ limit: 1 })).rejects.toMatchObject({ status: 401 });
        expect(events).toContain("SIGNED_OUT");
        expect(page.auth.getSession()).toBeNull();

        // A token that was presented and refused may be a sibling tab's stale
        // one; the next load has to ask, not assume.
        const before = b.refreshes();
        b.browser.cookie = "live";
        const next = b.load();
        await next.auth.isInitialized();
        expect(b.refreshes()).toBe(before + 1);
        expect(next.auth.restoreOutcome()).toBe("restored");
    });
});
