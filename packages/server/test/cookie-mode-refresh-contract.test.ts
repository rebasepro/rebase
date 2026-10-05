/**
 * Cookie mode, client and server together: a tab that outlives its access
 * token renews it.
 *
 * Under `cookieAuth` the server answers every sign-in and refresh with
 * `refreshToken: ""` — the cookie holds the token. `@rebasepro/client` stored
 * that `""` and sent it back as `{"refreshToken":""}` on every refresh from a
 * live tab, and `/auth/refresh` refused a blank token with 400 INVALID_INPUT
 * before it read the cookie. So any tab whose access token expired — every
 * laptop that slept past the hour — could not renew, and its user saw the
 * login screen; a reload "fixed" it, because a cold client has no session in
 * memory and sends no field at all.
 *
 * Both halves had tests, and both passed: the client's asserted what it sent,
 * the server's (`cookie-auth-session-doors`) drove `/refresh` the way a reload
 * does, with no body. Neither drove the in-tab refresh across the wire. Here
 * the real `createRebaseClient` talks to the real auth routes through a
 * `fetch` that keeps a cookie jar the way a browser does, and the access
 * token is pushed past its expiry before the client is asked to carry on.
 */

import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import { createRebaseClient } from "@rebasepro/client";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { configureJwt } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const SECRET = "cookie-mode-refresh-contract-secret-32-chars";
const ORIGIN = "https://app.example.com";
const COOKIE = "__rb_refresh";
const EMAIL = "sleeper@example.com";
const PASSWORD = "Str0ng-Passw0rd!";
/** Past the one-hour access token the server is configured with below. */
const PAST_ACCESS_EXPIRY_MS = 2 * 60 * 60 * 1000;

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => {
    configureJwt({ secret: SECRET, accessExpiresIn: "1h" });
});

/** Every client a test opens, closed after it whether it passed or not. */
const clients: Array<{ close: () => void }> = [];

afterEach(() => {
    for (const client of clients.splice(0)) client.close();
    jest.restoreAllMocks();
});

interface Sent {
    path: string;
    method: string;
    body: string;
    cookie: string | null;
}

/**
 * The server's auth routes, behind a `fetch` that behaves like a browser on
 * the same origin: it stores what `Set-Cookie` sets, drops what it expires,
 * and attaches the jar to every request that does not say `omit`.
 */
async function createBrowser() {
    const store = new MemoryAuthStore();
    await store.repo().createUser({ email: EMAIL, passwordHash: `hashed:${PASSWORD}`, emailVerified: true });

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/api/auth", createAuthRoutes({
        authRepo: store.repo(),
        authHooks: HOOKS,
        cookieAuth: { cookieName: COOKIE }
    }));

    const jar = new Map<string, string>();
    const sent: Sent[] = [];

    const browserFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        const cookie = init?.credentials === "omit" || jar.size === 0
            ? null
            : [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
        if (cookie) headers.set("cookie", cookie);
        sent.push({ path: url.pathname, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "", cookie });

        const res = await app.request(url.pathname + url.search, { ...init, headers });

        for (const setCookie of res.headers.getSetCookie()) {
            const [pair, ...attributes] = setCookie.split(";").map((part) => part.trim());
            const at = pair.indexOf("=");
            const name = pair.slice(0, at);
            const value = pair.slice(at + 1);
            const expired = attributes.some((attribute) => /^max-age=(0|-\d+)$/i.test(attribute));
            if (expired || value === "") jar.delete(name);
            else jar.set(name, value);
        }
        return res;
    }) as typeof fetch;

    const client = createRebaseClient({
        baseUrl: ORIGIN,
        realtime: false,
        auth: { authFlowMode: "cookie" },
        fetch: browserFetch
    });
    clients.push(client);
    await client.auth.isInitialized();

    return { client, jar, sent, app };
}

/** Move the clock past the access token's expiry, as a night's sleep does. */
function sleepPastAccessExpiry() {
    const woke = Date.now() + PAST_ACCESS_EXPIRY_MS;
    jest.spyOn(Date, "now").mockReturnValue(woke);
}

const refreshes = (sent: Sent[]) => sent.filter((request) => request.path === "/api/auth/refresh");

describe("cookie mode: a live tab renews an expired access token", () => {
    it("renews on the request the expired token is refused for, and that request succeeds", async () => {
        const { client, jar, sent } = await createBrowser();
        await client.auth.signInWithEmail(EMAIL, PASSWORD);
        expect(jar.has(COOKIE)).toBe(true);
        // The client holds no refresh token in cookie mode: the jar does.
        expect(client.auth.getSession()?.refreshToken).toBe("");
        const before = client.auth.getSession()?.accessToken;
        const refreshesBefore = refreshes(sent).length;

        sleepPastAccessExpiry();
        const user = await client.auth.getUser();

        expect(user.email).toBe(EMAIL);
        expect(client.auth.getSession()?.accessToken).not.toBe(before);
        const renewal = refreshes(sent).slice(refreshesBefore);
        expect(renewal).toHaveLength(1);
        // What the request carried: the cookie, and no token in the body.
        expect(renewal[0].cookie).toContain(`${COOKIE}=`);
        expect(JSON.parse(renewal[0].body)).not.toHaveProperty("refreshToken");
    });

    it("renews on the scheduled refresh a wake from sleep fires, and later requests need no other", async () => {
        const { client, sent } = await createBrowser();
        await client.auth.signInWithEmail(EMAIL, PASSWORD);
        const before = client.auth.getSession()?.accessToken;

        sleepPastAccessExpiry();
        // What the client's refresh timer calls when it fires late.
        const renewed = await client.auth.refreshSession();
        const refreshesAfterRenewal = refreshes(sent).length;

        expect(renewed.accessToken).not.toBe(before);
        expect((await client.auth.getUser()).email).toBe(EMAIL);
        expect(refreshes(sent)).toHaveLength(refreshesAfterRenewal);
    });

    it("signs out of the cookie's session, which no later refresh can renew", async () => {
        const { client, jar, app } = await createBrowser();
        await client.auth.signInWithEmail(EMAIL, PASSWORD);
        const cookie = `${COOKIE}=${jar.get(COOKIE)}`;

        await client.auth.signOut();

        expect(jar.has(COOKIE)).toBe(false);
        const replay = await app.request("/api/auth/refresh", { method: "POST", headers: { cookie } });
        expect(replay.status).toBe(401);
    });
});

/**
 * The server half on its own, for the clients already deployed.
 *
 * `@rebasepro/client` up to 0.23 sends `{"refreshToken":""}` beside the
 * cookie. Apps on a managed runtime are served by the runtime's copy of
 * `@rebasepro/server`, so this is what fixes them without a rebuild.
 */
describe("cookie mode: a blank body token is no token", () => {
    async function signedInCookie(app: Hono<HonoEnv>): Promise<string> {
        const res = await app.request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: EMAIL, password: PASSWORD })
        });
        expect(res.status).toBe(200);
        const match = res.headers.get("set-cookie")?.match(new RegExp(`${COOKIE}=([^;]*)`));
        return `${COOKIE}=${match![1]}`;
    }

    it("POST /refresh reads the cookie when the body says refreshToken: \"\"", async () => {
        const { app } = await createBrowser();
        const cookie = await signedInCookie(app);

        const res = await app.request("/api/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie },
            body: JSON.stringify({ refreshToken: "" })
        });

        expect(res.status).toBe(200);
        expect(((await res.json()) as { tokens: { accessToken: string } }).tokens.accessToken).toEqual(expect.any(String));
    });

    it("POST /logout revokes the cookie's session when the body says refreshToken: \"\"", async () => {
        const { app } = await createBrowser();
        const cookie = await signedInCookie(app);

        const res = await app.request("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie },
            body: JSON.stringify({ refreshToken: "" })
        });
        expect(res.status).toBe(200);

        const replay = await app.request("/api/auth/refresh", { method: "POST", headers: { cookie } });
        expect(replay.status).toBe(401);
    });

    it("POST /refresh with a blank body token and no cookie is not signed in, not malformed", async () => {
        const { app } = await createBrowser();

        const res = await app.request("/api/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: "" })
        });

        expect(res.status).toBe(401);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NO_SESSION");
    });
});
