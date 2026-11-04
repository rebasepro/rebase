/**
 * A refresh cookie whose value is not valid percent-encoding.
 *
 * This server writes the cookie with `encodeURIComponent`, so it never sets
 * one — but the browser sends whatever it holds under the name, and a sibling
 * subdomain can set one there (`Domain=` on the parent). Read with a bare
 * `decodeURIComponent`, such a value threw `URIError` out of the read: every
 * `/refresh` and every `/logout` answered 500, and `/logout`, the one route
 * that clears the cookie, never got as far as clearing it. The browser kept
 * sending it, so the session could not be renewed or ended until the user
 * cleared their cookies by hand.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { configureJwt } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const SECRET = "auth-cookie-malformed-secret-at-least-32-chars";
const COOKIE = "__rb_refresh";
const PASSWORD = "Str0ng-Passw0rd!";
const MALFORMED = `${COOKIE}=%E0%A4%A`;

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => {
    configureJwt({ secret: SECRET, accessExpiresIn: "1h" });
});

function createApp(store: MemoryAuthStore): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        authHooks: HOOKS,
        cookieAuth: { cookieName: COOKIE }
    }));
    return app;
}

function post(app: Hono<HonoEnv>, path: string, cookie: string, body?: Record<string, unknown>) {
    return Promise.resolve(app.request(`/auth${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: body === undefined ? undefined : JSON.stringify(body)
    }));
}

/** The refresh cookie a sign-in set, as `name=value`. */
function refreshCookie(res: Response): string {
    const match = res.headers.get("set-cookie")?.match(new RegExp(`${COOKIE}=([^;]*)`));
    if (!match?.[1]) throw new Error("no refresh cookie was set");
    return `${COOKIE}=${match[1]}`;
}

describe("a refresh cookie that is not valid percent-encoding", () => {
    it("is no session on /refresh, not a server error", async () => {
        const res = await post(createApp(new MemoryAuthStore()), "/refresh", MALFORMED);

        expect(res.status).toBe(401);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("NO_SESSION");
    });

    it("is cleared by /logout", async () => {
        const res = await post(createApp(new MemoryAuthStore()), "/logout", MALFORMED);

        expect(res.status).toBe(200);
        expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${COOKIE}=;.*Max-Age=0`));
    });

    it("does not hide a good cookie of the same name sent after it", async () => {
        // A browser sends every cookie it holds under the name — the one a
        // parent domain set and this host's own — in one header.
        const store = new MemoryAuthStore();
        await store.repo().createUser({ email: "dup@example.com", passwordHash: `hashed:${PASSWORD}`, emailVerified: true });
        const app = createApp(store);
        const login = await post(app, "/login", "", { email: "dup@example.com", password: PASSWORD });
        expect(login.status).toBe(200);

        const res = await post(app, "/refresh", `${MALFORMED}; ${refreshCookie(login)}`);

        expect(res.status).toBe(200);
    });
});
