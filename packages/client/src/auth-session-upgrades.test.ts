import { afterEach, describe, expect, it } from "@jest/globals";
import type { AuthChangeEvent } from "@rebasepro/types";
import { createRebaseClient } from "./index";

/**
 * The three answers that replace the session the client holds without being a
 * sign-in: a guest becoming an account (`linkAnonymous`, or `linkProvider`
 * from a guest), and a signed-in session stepping up to `aal2`
 * (`mfa.verifyChallenge` without a pending sign-in's token).
 *
 * Each one mints a new session on the server. In cookie mode its refresh token
 * comes back only as a `Set-Cookie`, which a browser keeps from a cross-origin
 * answer — an admin on `:5173` against an API on `:3001`, an app on
 * `app.example.com` against `api.example.com` — only when the request said
 * `credentials: "include"`. Without it the client held the new access token
 * and the cookie still named the old session: the next refresh, about an hour
 * later, put the client back on it — a guest again, or `aal1` again.
 */

const HOUR = 3_600_000;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Minted { uid: string; isAnonymous: boolean; aal: "aal1" | "aal2" }

/**
 * A cookie-mode backend behind a browser's cookie jar. The jar takes a
 * `Set-Cookie` only from a request made with `credentials: "include"`, as a
 * browser does for a cross-origin one. Each session's refresh token names
 * what it was minted as, so a refresh answers as that session.
 */
function createBrowser(options: { cookieAuth: boolean } = { cookieAuth: true }) {
    const sessions = new Map<string, Minted>();
    const accessTokens = new Map<string, Minted>();
    let jar: string | null = null;
    let n = 0;
    const mint = (minted: Minted, include: boolean) => {
        n++;
        const refreshToken = `R${n}`;
        const accessToken = `a${n}-${minted.isAnonymous ? "guest" : "account"}-${minted.aal}`;
        sessions.set(refreshToken, minted);
        accessTokens.set(accessToken, minted);
        if (options.cookieAuth && include) jar = refreshToken;
        return {
            tokens: {
                accessToken,
                refreshToken: options.cookieAuth ? "" : refreshToken,
                accessTokenExpiresAt: Date.now() + HOUR
            },
            user: { uid: minted.uid, email: minted.isAnonymous ? null : "a@b.c", isAnonymous: minted.isAnonymous }
        };
    };
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = url.replace("http://api.test/api", "");
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const include = init?.credentials === "include";
        const caller = accessTokens.get((headers.Authorization ?? "").replace(/^Bearer /, ""));
        if (path === "/auth/refresh") {
            const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { refreshToken?: string };
            const presented = options.cookieAuth ? (include ? jar : null) : body.refreshToken;
            const session = presented ? sessions.get(presented) : undefined;
            if (!session) return json({ error: { code: "NO_SESSION", message: "No refresh token presented" } }, 401);
            return json(mint(session, include));
        }
        if (path === "/auth/login") return json(mint({ uid: "u1", isAnonymous: false, aal: "aal1" }, include));
        if (path === "/auth/anonymous") return json(mint({ uid: "g1", isAnonymous: true, aal: "aal1" }, include), 201);
        if (!caller) return json({ error: { code: "UNAUTHORIZED", message: "no token" } }, 401);
        if (path === "/auth/anonymous/link") return json(mint({ uid: caller.uid, isAnonymous: false, aal: "aal1" }, include));
        if (path === "/auth/link/google") {
            if (!caller.isAnonymous) return json({ success: true, provider: "google", alreadyLinked: false, photoURL: null });
            return json({
                ...mint({ uid: caller.uid, isAnonymous: false, aal: "aal1" }, include),
                success: true,
                provider: "google",
                alreadyLinked: false,
                photoURL: null
            });
        }
        if (path === "/auth/mfa/challenge/verify") return json(mint({ uid: caller.uid, isAnonymous: false, aal: "aal2" }, include));
        return json({ error: { code: "NOT_FOUND", message: path } }, 404);
    }) as typeof fetch;

    const clients: { close: () => void }[] = [];
    return {
        jarSession: () => (jar ? sessions.get(jar) : undefined),
        load() {
            const client = createRebaseClient({
                baseUrl: "http://api.test",
                realtime: false,
                fetch: fetchFn,
                auth: { authFlowMode: options.cookieAuth ? "cookie" : "json", autoRefresh: false }
            });
            clients.push(client);
            return client;
        },
        close: () => clients.splice(0).forEach((c) => c.close())
    };
}

const browsers: { close: () => void }[] = [];
function browser(options?: { cookieAuth: boolean }) {
    const b = createBrowser(options);
    browsers.push(b);
    return b;
}
afterEach(() => {
    browsers.splice(0).forEach((b) => b.close());
});

describe("an MFA step-up in cookie mode", () => {
    it("keeps the aal2 session's cookie, so a refresh stays at aal2", async () => {
        const b = browser();
        const page = b.load();
        await page.auth.isInitialized();
        await page.auth.signInWithEmail("a@b.c", "pw");

        await page.auth.mfa.verifyChallenge("ch1", "418293");

        expect(b.jarSession()?.aal).toBe("aal2");
        const refreshed = await page.auth.refreshSession();
        expect(refreshed.accessToken).toMatch(/-aal2$/);
    });
});

describe("a guest becoming an account in cookie mode", () => {
    it("with a password keeps the account's cookie, so a refresh is not a guest again", async () => {
        const b = browser();
        const page = b.load();
        await page.auth.isInitialized();
        await page.auth.signInAnonymously();

        await page.auth.linkAnonymous("a@b.c", "correct-horse");

        expect(b.jarSession()?.isAnonymous).toBe(false);
        const refreshed = await page.auth.refreshSession();
        expect(refreshed.accessToken).toMatch(/-account-/);
    });

    it("with a provider adopts the account's session and its cookie", async () => {
        const b = browser();
        const page = b.load();
        await page.auth.isInitialized();
        await page.auth.signInAnonymously();
        const events: AuthChangeEvent[] = [];
        page.auth.onAuthStateChange((event) => { events.push(event); });

        const result = await page.auth.linkProvider("google", { idToken: "id-token" });

        expect(result.alreadyLinked).toBe(false);
        expect(page.auth.getSession()?.user.isAnonymous).toBe(false);
        expect(page.auth.getSession()?.accessToken).toMatch(/-account-/);
        expect(events).toContain("USER_UPDATED");
        expect(b.jarSession()?.isAnonymous).toBe(false);
    });
});

describe("a guest linking a provider in json mode", () => {
    it("holds the account's session, refresh token included", async () => {
        const b = browser({ cookieAuth: false });
        const page = b.load();
        await page.auth.isInitialized();
        await page.auth.signInAnonymously();

        await page.auth.linkProvider("google", { idToken: "id-token" });

        expect(page.auth.getSession()?.user.isAnonymous).toBe(false);
        const refreshed = await page.auth.refreshSession();
        expect(refreshed.accessToken).toMatch(/-account-/);
    });

    it("leaves the session of an account that links a provider as it was", async () => {
        const b = browser({ cookieAuth: false });
        const page = b.load();
        await page.auth.isInitialized();
        await page.auth.signInWithEmail("a@b.c", "pw");
        const before = page.auth.getSession();

        await page.auth.linkProvider("google", { idToken: "id-token" });

        expect(page.auth.getSession()).toBe(before);
    });
});
