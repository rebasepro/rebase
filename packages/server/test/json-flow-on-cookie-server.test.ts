/**
 * A json client renews against a server with `cookieAuth`.
 *
 * Under `cookieAuth` every sign-in and refresh put the refresh token in an
 * HttpOnly cookie and answered the body's with `""`. A client that keeps its
 * token itself — Node, React Native, or a second client in a browser that keeps
 * a guest's sign-in apart from the page's cookie session — was handed nothing
 * to renew with and was signed out when its first access token expired, about
 * an hour in. The Rebase runtime always sets `cookieAuth`, so on a managed
 * backend no such client could stay signed in.
 *
 * Such a client now says so with `x-rebase-auth-flow: json`, and the server
 * answers that request as one without `cookieAuth` would: the token in the
 * body, read back from the body, and the cookie neither read, set nor cleared.
 * The cookie path is unchanged, and a json request can never turn the cookie
 * into a token in a body the page's script can read.
 *
 * The real `createRebaseClient` talks to the real auth routes through a
 * `fetch` that keeps a cookie jar the way a browser does.
 */

import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import { createRebaseClient, createMemoryStorage } from "@rebasepro/client";
import { AUTH_FLOW_HEADER } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { configureJwt } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const SECRET = "json-flow-on-cookie-server-secret-32-chars";
const ORIGIN = "https://app.example.com";
const COOKIE = "__rb_refresh";
const EMAIL = "host@example.com";
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

const clients: Array<{ close: () => void }> = [];

afterEach(() => {
    for (const client of clients.splice(0)) client.close();
    jest.restoreAllMocks();
});

interface Sent {
    path: string;
    body: string;
    cookie: string | null;
    flow: string | null;
}

/**
 * The auth routes as the runtime mounts them (`cookieAuth` on), behind a
 * `fetch` that behaves like a browser on the page's origin: it keeps what
 * `Set-Cookie` sets, and attaches the jar to every request that does not say
 * `omit` — and takes no cookie from the answer to one that does.
 */
async function createSite() {
    const store = new MemoryAuthStore();
    await store.repo().createUser({ email: EMAIL, passwordHash: `hashed:${PASSWORD}`, emailVerified: true });

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/api/auth", createAuthRoutes({
        authRepo: store.repo(),
        authHooks: HOOKS,
        allowAnonymous: true,
        cookieAuth: { cookieName: COOKIE }
    }));

    const jar = new Map<string, string>();
    const sent: Sent[] = [];

    const browserFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        const omit = init?.credentials === "omit";
        const cookie = omit || jar.size === 0
            ? null
            : [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
        if (cookie) headers.set("cookie", cookie);
        sent.push({ path: url.pathname, body: typeof init?.body === "string" ? init.body : "", cookie, flow: headers.get(AUTH_FLOW_HEADER) });

        const res = await app.request(url.pathname + url.search, { ...init, headers });
        if (omit) return res;

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

    /** A fetch that never sends or takes the page's cookie, as a guest client's does. */
    const noCookieFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
        browserFetch(input, { ...init, credentials: "omit" })) as typeof fetch;

    const open = (options: Parameters<typeof createRebaseClient>[0]) => {
        const client = createRebaseClient({ baseUrl: ORIGIN, realtime: false, ...options });
        clients.push(client);
        return client;
    };

    return { app, jar, sent, browserFetch, noCookieFetch, open };
}

function sleepPastAccessExpiry() {
    const woke = Date.now() + PAST_ACCESS_EXPIRY_MS;
    jest.spyOn(Date, "now").mockReturnValue(woke);
}

const refreshes = (sent: Sent[]) => sent.filter((request) => request.path === "/api/auth/refresh");

describe("a json client against a cookieAuth server", () => {
    it("is handed its refresh token in the body, renews with it, and keeps the rotated one", async () => {
        const { sent, noCookieFetch, open } = await createSite();
        const client = open({ fetch: noCookieFetch, auth: { authFlowMode: "json", autoRefresh: false } });

        await client.auth.signInWithEmail(EMAIL, PASSWORD);
        const first = client.auth.getSession();
        expect(first?.refreshToken).toMatch(/.+/);
        expect(sent.find((request) => request.path === "/api/auth/login")?.flow).toBe("json");

        sleepPastAccessExpiry();
        const user = await client.auth.getUser();

        expect(user?.email).toBe(EMAIL);
        const renewal = refreshes(sent);
        expect(renewal).toHaveLength(1);
        expect(renewal[0]).toMatchObject({ flow: "json", cookie: null });
        expect(JSON.parse(renewal[0].body)).toEqual({ refreshToken: first?.refreshToken });
        const second = client.auth.getSession();
        expect(second?.accessToken).not.toBe(first?.accessToken);
        expect(second?.refreshToken).toMatch(/.+/);
        expect(second?.refreshToken).not.toBe(first?.refreshToken);
    });

    it("signs out of its own session from the body token", async () => {
        const { app, noCookieFetch, open } = await createSite();
        const client = open({ fetch: noCookieFetch, auth: { authFlowMode: "json", autoRefresh: false } });
        await client.auth.signInWithEmail(EMAIL, PASSWORD);
        const refreshToken = client.auth.getSession()!.refreshToken;

        await client.auth.signOut();

        const replay = await app.request("/api/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json", [AUTH_FLOW_HEADER]: "json" },
            body: JSON.stringify({ refreshToken })
        });
        expect(replay.status).toBe(401);
    });
});

describe("a guest client beside the page's signed-in account", () => {
    it("renews the guest, leaves the account's cookie alone, and says nothing at sign-in", async () => {
        const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const { jar, sent, browserFetch, noCookieFetch, open } = await createSite();

        const account = open({ fetch: browserFetch, auth: { authFlowMode: "cookie", autoRefresh: false } });
        await account.auth.isInitialized();
        await account.auth.signInWithEmail(EMAIL, PASSWORD);
        const accountCookie = jar.get(COOKIE);
        expect(accountCookie).toEqual(expect.any(String));

        // The room's guest: its own storage, never the page's cookie.
        const guest = open({ fetch: noCookieFetch, auth: { storage: createMemoryStorage(), autoRefresh: false } });
        await guest.auth.signInAnonymously();
        expect(guest.auth.getSession()?.user.isAnonymous).toBe(true);
        expect(guest.auth.getSession()?.refreshToken).toMatch(/.+/);
        expect(jar.get(COOKIE)).toBe(accountCookie);

        sleepPastAccessExpiry();
        const guestBefore = guest.auth.getSession()?.accessToken;
        expect(await guest.auth.getAccessToken()).not.toBe(guestBefore);
        expect(guest.auth.getSession()?.user.isAnonymous).toBe(true);
        // The account renews through its cookie, untouched by the guest's.
        expect((await account.auth.getUser())?.email).toBe(EMAIL);
        expect(account.auth.getSession()?.user.isAnonymous).toBe(false);

        const guestRefresh = refreshes(sent).find((request) => request.flow === "json");
        expect(guestRefresh?.cookie).toBeNull();
        expect(error.mock.calls.filter(([first]) => typeof first === "string" && first.startsWith("[rebase]"))).toHaveLength(0);
    });
});

describe("the cookie path keeps its protection", () => {
    async function signedInCookie(app: Hono<HonoEnv>): Promise<string> {
        const res = await app.request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: EMAIL, password: PASSWORD })
        });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { tokens: { refreshToken: string } }).tokens.refreshToken).toBe("");
        const match = res.headers.get("set-cookie")?.match(new RegExp(`${COOKIE}=([^;]*)`));
        return `${COOKIE}=${match![1]}`;
    }

    it("never answers a json request with the cookie's session: the cookie is not read", async () => {
        const { app } = await createSite();
        const cookie = await signedInCookie(app);

        // What a script on the page could send: the cookie rides along, the
        // header asks for the body. It gets nothing, and the cookie is kept.
        const res = await app.request("/api/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie, [AUTH_FLOW_HEADER]: "json" },
            body: "{}"
        });

        expect(res.status).toBe(401);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NO_SESSION");
        expect(res.headers.get("set-cookie")).toBeNull();

        const still = await app.request("/api/auth/refresh", { method: "POST", headers: { cookie } });
        expect(still.status).toBe(200);
    });

    it("never sets or clears the cookie on a json request", async () => {
        const { app } = await createSite();
        const cookie = await signedInCookie(app);

        const login = await app.request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json", [AUTH_FLOW_HEADER]: "json" },
            body: JSON.stringify({ email: EMAIL, password: PASSWORD })
        });
        expect(login.status).toBe(200);
        expect(login.headers.get("set-cookie")).toBeNull();
        const { refreshToken } = ((await login.json()) as { tokens: { refreshToken: string } }).tokens;
        expect(refreshToken).toMatch(/.+/);

        const logout = await app.request("/api/auth/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie, [AUTH_FLOW_HEADER]: "json" },
            body: JSON.stringify({ refreshToken })
        });
        expect(logout.status).toBe(200);
        expect(logout.headers.get("set-cookie")).toBeNull();

        // The json session is over; the cookie's is not.
        const json = await app.request("/api/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json", [AUTH_FLOW_HEADER]: "json" },
            body: JSON.stringify({ refreshToken })
        });
        expect(json.status).toBe(401);
        expect((await app.request("/api/auth/refresh", { method: "POST", headers: { cookie } })).status).toBe(200);
    });

    it("answers a request without the header as before: the token in the cookie, \"\" in the body", async () => {
        const { app } = await createSite();
        const cookie = await signedInCookie(app);

        const res = await app.request("/api/auth/refresh", { method: "POST", headers: { cookie } });

        expect(res.status).toBe(200);
        expect(((await res.json()) as { tokens: { refreshToken: string } }).tokens.refreshToken).toBe("");
        expect(res.headers.get("set-cookie")).toContain(`${COOKIE}=`);
    });
});
