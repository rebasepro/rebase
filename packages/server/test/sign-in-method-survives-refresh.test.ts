/**
 * `providerId` says how the session was signed in, after a refresh as well as
 * before it.
 *
 * It was hardcoded `"password"` on refresh and on `/me`, so a Google user read
 * `google` at sign-in and `password` an access-token lifetime later, and a
 * guest read `anonymous`, then `password` with `isAnonymous: true`. The method
 * is a property of the sign-in, as the assurance level is: it is written on the
 * session's refresh token at sign-in, carried across every rotation, and read
 * back by refresh and by `/me`, which finds the session by the access token's
 * `sid`.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { configureJwt } from "../src/auth/jwt";
import { oauthCodeFlowSchema } from "../src/auth/oauth-code-flow";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

beforeAll(() => configureJwt({ secret: "sign-in-method-secret-at-least-32-chars", accessExpiresIn: "1h" }));

type AuthBody = { user: { providerId: string; isAnonymous: boolean }; tokens: { accessToken: string; refreshToken: string } };

function world() {
    const store = new MemoryAuthStore();
    const adapter = createBuiltinAuthAdapter({
        authRepository: store.repo(),
        allowRegistration: true,
        allowAnonymous: true,
        authHooks: {
            hashPassword: async (password: string) => `hashed:${password}`,
            verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
        },
        oauthProviders: [{
            id: "google",
            schema: oauthCodeFlowSchema(),
            verify: async () => ({ providerId: "g-1", email: "someone@corp.com", emailVerified: true })
        }]
    });
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", adapter.createAuthRoutes() as Hono<HonoEnv>);
    const call = async (method: string, path: string, body?: unknown, token?: string) => {
        const res = await app.request(path, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : {} };
    };
    return { store, call };
}

/** Refresh twice — the second from a token minted by a rotation — then ask `/me`. */
async function methodAfterRefresh(call: ReturnType<typeof world>["call"], signedIn: AuthBody) {
    const first = await call("POST", "/auth/refresh", { refreshToken: signedIn.tokens.refreshToken });
    expect(first.status).toBe(200);
    const second = await call("POST", "/auth/refresh", { refreshToken: (first.json as AuthBody).tokens.refreshToken });
    expect(second.status).toBe(200);
    const me = await call("GET", "/auth/me", undefined, (second.json as AuthBody).tokens.accessToken);
    expect(me.status).toBe(200);
    return {
        refreshed: (first.json as AuthBody).user.providerId,
        rotatedAgain: (second.json as AuthBody).user.providerId,
        me: (me.json as AuthBody).user.providerId
    };
}

describe("the sign-in method across refresh", () => {
    it("stays the provider's for a provider sign-in", async () => {
        const { call } = world();
        const signedIn = await call("POST", "/auth/google", { code: "c", redirectUri: "https://app.test/cb" });
        expect(signedIn.status).toBe(200);
        expect((signedIn.json as AuthBody).user.providerId).toBe("google");

        expect(await methodAfterRefresh(call, signedIn.json as AuthBody)).toEqual({ refreshed: "google", rotatedAgain: "google", me: "google" });
    });

    it("stays anonymous for a guest", async () => {
        const { call } = world();
        const guest = await call("POST", "/auth/anonymous");
        expect(guest.status).toBe(201);

        expect(await methodAfterRefresh(call, guest.json as AuthBody)).toEqual({ refreshed: "anonymous", rotatedAgain: "anonymous", me: "anonymous" });
    });

    it("stays password for a password sign-in, and is stored on the session's tokens", async () => {
        const { store, call } = world();
        await call("POST", "/auth/register", { email: "member@corp.com", password: "Passw0rd-Member" });
        const signedIn = await call("POST", "/auth/login", { email: "member@corp.com", password: "Passw0rd-Member" });

        expect(await methodAfterRefresh(call, signedIn.json as AuthBody)).toEqual({ refreshed: "password", rotatedAgain: "password", me: "password" });
        expect(new Set(store.refreshTokens.map(t => t.method))).toEqual(new Set(["password"]));
    });

    it("reads each session's own method on /me when one account signs in two ways", async () => {
        const { store, call } = world();
        const google = (await call("POST", "/auth/google", { code: "c", redirectUri: "https://app.test/cb" })).json as AuthBody;
        // The same account, now with a password too.
        const uid = [...store.users.values()][0].id;
        store.users.get(uid)!.passwordHash = "hashed:Passw0rd-Member";
        const password = (await call("POST", "/auth/login", { email: "someone@corp.com", password: "Passw0rd-Member" })).json as AuthBody;

        expect((await call("GET", "/auth/me", undefined, google.tokens.accessToken)).json.user.providerId).toBe("google");
        expect((await call("GET", "/auth/me", undefined, password.tokens.accessToken)).json.user.providerId).toBe("password");
    });
});
