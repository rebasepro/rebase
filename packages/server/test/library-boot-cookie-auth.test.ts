/**
 * A backend booted as a library keeps the refresh token in a cookie, as the
 * runtime does, so a browser client stays signed in across a reload.
 *
 * A browser client defaults to cookie mode: it keeps nothing in storage and
 * restores on load from the HttpOnly cookie the server set. The runtime always
 * sets `cookieAuth`, but `initializeRebaseBackend` left it off unless the app
 * passed it. Such a server answered the refresh token in the body, the client
 * dropped it, and every reload of a hand-wired backend's app showed the login
 * screen. The Rebase console was one.
 *
 * Booted for real through `initializeRebaseBackend`; the real
 * `createRebaseClient` talks to it through a `fetch` that keeps a cookie jar the
 * way a browser does. A reload is a second client on the same jar.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import { createServer } from "node:http";
import { createRebaseClient } from "@rebasepro/client";
import { AUTH_FLOW_HEADER } from "@rebasepro/types";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { RebaseAuthConfig } from "../src/backend/options";
import { fakeDataDriver } from "./helpers/server-a-fakes";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    ...jest.requireActual<Record<string, unknown>>("../src/utils/logger"),
    logger: { info: jest.fn(),
warn: jest.fn(),
error: jest.fn(),
debug: jest.fn(),
child: jest.fn().mockReturnThis() }
}));

import { initializeRebaseBackend } from "../src/init";
import { tablesFrom } from "./helpers/tables";

const ORIGIN = "https://app.example.com";
const COOKIE = "__rb_refresh";
const EMAIL = "reader@example.com";
const PASSWORD = "Str0ng-Passw0rd!";

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

const clients: Array<{ close: () => void }> = [];

afterEach(() => {
    for (const client of clients.splice(0)) client.close();
});

async function boot(auth: Partial<RebaseAuthConfig> = {}): Promise<Hono<HonoEnv>> {
    const store = new MemoryAuthStore();
    await store.repo().createUser({ email: EMAIL,
passwordHash: `hashed:${PASSWORD}`,
emailVerified: true });
    const bootstrapper: BackendBootstrapper = {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return {
                driver: fakeDataDriver({ fetchCollection: async () => [],
admin: { executeSql: async () => [] } }),
                collections: [],
                internals: {}
            };
        },
        async initializeAuth() {
            return { userService: {},
authRepository: store.repo() };
        }
    };
    const app = new Hono<HonoEnv>();
    await initializeRebaseBackend({
        app,
        // Never listened on: the backend only attaches its websocket to it.
        server: createServer(),
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        auth: { requireAuth: false,
jwtSecret: "library-boot-cookie-auth-secret-0123456789",
hooks: HOOKS,
...auth }
    });
    return app;
}

/** A browser on the page's origin: keeps what `Set-Cookie` sets, sends it back. */
function browserFetchFor(app: Hono<HonoEnv>) {
    const jar = new Map<string, string>();
    const browserFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        if (jar.size > 0) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
        const res = await app.request(url.pathname + url.search, { ...init,
headers });
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
    return { jar,
browserFetch };
}

/**
 * A page load: the client a browser app creates. Jest has no `document`, so the
 * browser's default flow mode is named rather than inferred.
 */
function pageLoad(browserFetch: typeof fetch) {
    const client = createRebaseClient({
        baseUrl: ORIGIN,
        realtime: false,
        fetch: browserFetch,
        auth: { authFlowMode: "cookie",
autoRefresh: false }
    });
    clients.push(client);
    return client;
}

const login = (app: Hono<HonoEnv>, headers: Record<string, string> = {}) => app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json",
...headers },
    body: JSON.stringify({ email: EMAIL,
password: PASSWORD })
});

describe("a backend booted with initializeRebaseBackend and no cookieAuth", () => {
    it("keeps a browser client signed in across a reload", async () => {
        const app = await boot();
        const { jar, browserFetch } = browserFetchFor(app);

        const first = pageLoad(browserFetch);
        await first.auth.isInitialized();
        await first.auth.signInWithEmail(EMAIL, PASSWORD);
        expect(jar.get(COOKIE)).toEqual(expect.any(String));
        first.close();

        const reloaded = pageLoad(browserFetch);
        await reloaded.auth.isInitialized();

        expect(reloaded.auth.getSession()?.user.email).toBe(EMAIL);
    });

    it("sets the refresh token as an HttpOnly, Secure cookie and leaves the body's empty", async () => {
        const app = await boot();

        const res = await login(app);

        expect(res.status).toBe(200);
        expect(((await res.json()) as { tokens: { refreshToken: string } }).tokens.refreshToken).toBe("");
        const cookie = res.headers.get("set-cookie") ?? "";
        expect(cookie).toMatch(new RegExp(`^${COOKIE}=[^;]+`));
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/Secure/);
        expect(cookie).toMatch(/SameSite=Lax/);
    });

    it("still answers a json-flow client in the body", async () => {
        const app = await boot();

        const res = await login(app, { [AUTH_FLOW_HEADER]: "json" });

        expect(res.status).toBe(200);
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(((await res.json()) as { tokens: { refreshToken: string } }).tokens.refreshToken).toMatch(/.+/);
    });
});

describe("cookieAuth: false", () => {
    it("answers the refresh token in the body and sets no cookie", async () => {
        const app = await boot({ cookieAuth: false });

        const res = await login(app);

        expect(res.status).toBe(200);
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(((await res.json()) as { tokens: { refreshToken: string } }).tokens.refreshToken).toMatch(/.+/);
    });
});

describe("cookieAuth set by the app", () => {
    it("is used as given", async () => {
        const app = await boot({ cookieAuth: { cookieName: "app_refresh",
sameSite: "Strict" } });

        const res = await login(app);

        const cookie = res.headers.get("set-cookie") ?? "";
        expect(cookie).toMatch(/^app_refresh=[^;]+/);
        expect(cookie).toMatch(/SameSite=Strict/);
    });
});
