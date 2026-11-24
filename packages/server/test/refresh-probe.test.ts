/**
 * A first visit asks whether a session exists, and "no" is not an error.
 *
 * In cookie mode the refresh token is an HttpOnly cookie the page cannot read,
 * so `@rebasepro/client` asks on every load — `POST /auth/refresh` — because
 * only the server can see whether the browser holds one. For a visitor who has
 * never signed in, the answer was `401 NO_SESSION`: correct, but the browser
 * prints every 4xx as a red "Failed to load resource" line, so every new user
 * met a console error on the Welcome screen before doing anything.
 *
 * The load-time restore now says it is only asking (`{ "probe": true }` in the
 * body), and to that request alone, when no refresh token is presented at
 * all, the server answers `204 No Content`. Everything else is as it was: a
 * refresh that is not a probe still gets `401 NO_SESSION`, and a token that is
 * presented — unknown, expired, revoked — is still refused with its 401
 * whether the request probes or not.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import { createRebaseClient } from "@rebasepro/client";
import { AUTH_FLOW_HEADER } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { configureJwt } from "../src/auth/jwt";
import { logger } from "../src/utils/logger";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const SECRET = "refresh-probe-test-secret-at-least-32-chars";
const ORIGIN = "https://app.example.com";
const COOKIE = "__rb_refresh";
const EMAIL = "first@example.com";
const PASSWORD = "Str0ng-Passw0rd!";

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => {
    configureJwt({ secret: SECRET, accessExpiresIn: "1h" });
});

beforeEach(() => {
    jest.mocked(logger.warn).mockClear();
});

const clients: Array<{ close: () => void }> = [];

afterEach(() => {
    for (const client of clients.splice(0)) client.close();
});

async function createServer() {
    const store = new MemoryAuthStore();
    await store.repo().createUser({ email: EMAIL, passwordHash: `hashed:${PASSWORD}`, emailVerified: true });
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/api/auth", createAuthRoutes({
        authRepo: store.repo(),
        authHooks: HOOKS,
        cookieAuth: { cookieName: COOKIE }
    }));
    return { app, store };
}

function refresh(app: Hono<HonoEnv>, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body)
    });
}

/** A live refresh cookie, as a sign-in sets it. */
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

async function errorCode(res: Response): Promise<string> {
    return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("POST /auth/refresh with { probe: true }", () => {
    it("answers 204 with no body and no cookie when no refresh token is presented", async () => {
        const { app } = await createServer();

        const res = await refresh(app, { probe: true });

        expect(res.status).toBe(204);
        expect(await res.text()).toBe("");
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("answers 204 to a json-flow probe whose body holds no token", async () => {
        const { app } = await createServer();

        const res = await refresh(app, { probe: true }, { [AUTH_FLOW_HEADER]: "json" });

        expect(res.status).toBe(204);
    });

    it("answers 204 when the body's token is the blank a cookie-mode answer carries", async () => {
        const { app } = await createServer();

        const res = await refresh(app, { probe: true, refreshToken: "" });

        expect(res.status).toBe(204);
    });

    it("restores the session of a live cookie, like every refresh", async () => {
        const { app } = await createServer();
        const cookie = await signedInCookie(app);

        const res = await refresh(app, { probe: true }, { cookie });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { tokens: { accessToken: string }; user: { email: string } };
        expect(body.tokens.accessToken).toEqual(expect.any(String));
        expect(body.user.email).toBe(EMAIL);
    });

    it("still refuses a cookie the server does not know with 401 INVALID_TOKEN", async () => {
        const { app } = await createServer();

        const res = await refresh(app, { probe: true }, { cookie: `${COOKIE}=not-a-token-this-server-issued` });

        expect(res.status).toBe(401);
        expect(await errorCode(res)).toBe("INVALID_TOKEN");
    });

    it("still refuses an unknown token in a json-flow body with 401 INVALID_TOKEN", async () => {
        const { app } = await createServer();

        const res = await refresh(app, { probe: true, refreshToken: "forged" }, { [AUTH_FLOW_HEADER]: "json" });

        expect(res.status).toBe(401);
        expect(await errorCode(res)).toBe("INVALID_TOKEN");
    });

    it("still refuses an expired token with 401 TOKEN_EXPIRED", async () => {
        const { app, store } = await createServer();
        const cookie = await signedInCookie(app);
        for (const row of store.refreshTokens) row.expiresAt = new Date(Date.now() - 1000);

        const res = await refresh(app, { probe: true }, { cookie });

        expect(res.status).toBe(401);
        expect(await errorCode(res)).toBe("TOKEN_EXPIRED");
    });

    it("still refuses a revoked token with 401 SESSION_REVOKED", async () => {
        const { app, store } = await createServer();
        const cookie = await signedInCookie(app);
        for (const row of store.refreshTokens) row.revoked = true;

        const res = await refresh(app, { probe: true }, { cookie });

        expect(res.status).toBe(401);
        expect(await errorCode(res)).toBe("SESSION_REVOKED");
    });
});

describe("POST /auth/refresh without a probe", () => {
    it.each([
        ["no body", undefined],
        ["an empty body", {}],
        ["probe: false", { probe: false }]
    ])("answers 401 NO_SESSION to %s with no token, and logs no warning", async (_label, body) => {
        const { app } = await createServer();

        const res = body === undefined
            ? await app.request("/api/auth/refresh", { method: "POST" })
            : await refresh(app, body);

        expect(res.status).toBe(401);
        expect(await errorCode(res)).toBe("NO_SESSION");
        // Having no token at all is a visitor, not an attack signal.
        expect(logger.warn).not.toHaveBeenCalled();
    });
});

interface Sent {
    body: string;
    status: number;
}

/**
 * The real client over the real routes, through a `fetch` that keeps a cookie
 * jar the way a browser on the same origin does.
 */
async function loadPage(app: Hono<HonoEnv>, jar: Map<string, string>) {
    const refreshes: Sent[] = [];
    const statuses: number[] = [];
    const browserFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        if (init?.credentials !== "omit" && jar.size > 0) {
            headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
        }
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
        statuses.push(res.status);
        if (url.pathname === "/api/auth/refresh") {
            refreshes.push({ body: typeof init?.body === "string" ? init.body : "", status: res.status });
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
    return { client, refreshes, statuses };
}

describe("a page load, client and server together", () => {
    it("on a first visit asks once, is answered 204, and no request is refused", async () => {
        const { app } = await createServer();

        const { client, refreshes, statuses } = await loadPage(app, new Map());

        expect(client.auth.restoreOutcome()).toBe("none");
        expect(client.auth.getSession()).toBeNull();
        expect(refreshes).toEqual([{ body: JSON.stringify({ probe: true }), status: 204 }]);
        expect(statuses.filter((status) => status >= 400)).toEqual([]);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("after a sign-in, restores the session on the next load", async () => {
        const { app } = await createServer();
        const jar = new Map<string, string>();
        const first = await loadPage(app, jar);
        await first.client.auth.signInWithEmail(EMAIL, PASSWORD);
        expect(jar.has(COOKIE)).toBe(true);

        const next = await loadPage(app, jar);

        expect(next.client.auth.restoreOutcome()).toBe("restored");
        expect(next.client.auth.getSession()?.user.email).toBe(EMAIL);
        expect(next.refreshes.map((r) => r.status)).toEqual([200]);
    });

    it("with a cookie the server does not know, is still refused with 401 and restores nothing", async () => {
        const { app } = await createServer();
        const jar = new Map([[COOKIE, "issued-by-some-other-database"]]);

        const { client, refreshes } = await loadPage(app, jar);

        expect(refreshes.map((r) => r.status)).toEqual([401]);
        expect(client.auth.restoreOutcome()).toBe("none");
        expect(client.auth.getSession()).toBeNull();
    });
});
