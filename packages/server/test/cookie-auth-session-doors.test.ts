/**
 * Cookie mode, held to every door that opens a session.
 *
 * `cookieAuth` moves the refresh token out of the JSON body and into an
 * httpOnly cookie, so no script on the page can read the long-lived
 * credential. Register, login, OAuth, refresh and MFA verify did that. Magic
 * link, email code, guest sign-in and guest upgrade each built their response
 * by hand and skipped it: the token came back in the body, readable by any
 * script, and no cookie was set — so the first page reload posted `/refresh`
 * with nothing, got `401 NO_SESSION`, and signed the user out.
 *
 * Each case is one door, driven for real against a store that keeps state, and
 * each is held to the same outcome: a cookie, an empty body token, and a
 * cookie that the next `/refresh` (what a reload does) accepts.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { hashToken } from "../src/auth/admin-user-ops";
import { configureJwt } from "../src/auth/jwt";
import { oauthCodeFlowSchema } from "../src/auth/oauth-code-flow";
import { otpTokenMaterial } from "../src/auth/otp-routes";
import { encryptTotpSecret } from "../src/auth/mfa-crypto";
import { base32Decode, generateTotp, generateTotpSecret } from "../src/auth/mfa";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const SECRET = "cookie-auth-session-doors-secret-at-least-32-chars";
const COOKIE = "__rb_refresh";
const PASSWORD = "Str0ng-Passw0rd!";

/** A readable, instant stand-in for scrypt. */
const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => {
    process.env.MFA_ENCRYPTION_KEY = "cookie-doors-mfa-key-0123456789abcdef0123";
    configureJwt({ secret: SECRET, accessExpiresIn: "1h" });
});

function createApp(store: MemoryAuthStore): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        authHooks: HOOKS,
        allowRegistration: true,
        allowAnonymous: true,
        enableMagicLink: true,
        enableEmailOtp: true,
        cookieAuth: { cookieName: COOKIE },
        oauthProviders: [{
            id: "acme",
            schema: oauthCodeFlowSchema(),
            verify: async () => ({ providerId: "acme-1", email: "oauth@example.com", emailVerified: true })
        }]
    }));
    return app;
}

function post(app: Hono<HonoEnv>, path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) {
    return Promise.resolve(app.request(`/auth${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
    }));
}

/** `name=value` of the refresh cookie a response set, or null. */
function refreshCookie(res: Response): string | null {
    const header = res.headers.get("set-cookie");
    const match = header?.match(new RegExp(`${COOKIE}=([^;]*)`));
    return match && match[1] ? `${COOKIE}=${match[1]}` : null;
}

interface SessionBody {
    tokens: { accessToken: string; refreshToken: string };
}

/**
 * Each door, as a function that performs it against a fresh store and returns
 * the response that opened the session.
 */
const DOORS: Array<[string, (app: Hono<HonoEnv>, store: MemoryAuthStore) => Promise<Response>]> = [
    ["POST /register", (app) => post(app, "/register", { email: "reg@example.com", password: PASSWORD })],
    ["POST /login", async (app, store) => {
        await store.repo().createUser({ email: "login@example.com", passwordHash: `hashed:${PASSWORD}`, emailVerified: true });
        return post(app, "/login", { email: "login@example.com", password: PASSWORD });
    }],
    ["POST /<provider>", (app) => post(app, "/acme", { code: "c", redirectUri: "https://app.example.com/cb" })],
    ["POST /magic-link/verify", async (app, store) => {
        const user = await store.repo().createUser({ email: "magic@example.com", emailVerified: true });
        await store.repo().createMagicLinkToken(user.id, hashToken("mailed-token"), new Date(Date.now() + 60_000));
        return post(app, "/magic-link/verify", { token: "mailed-token" });
    }],
    ["POST /otp/verify", async (app, store) => {
        const user = await store.repo().createUser({ email: "otp@example.com", emailVerified: true });
        await store.repo().createMagicLinkToken(user.id, hashToken(otpTokenMaterial("otp@example.com", "123456")), new Date(Date.now() + 60_000));
        return post(app, "/otp/verify", { email: "otp@example.com", code: "123456" });
    }],
    ["POST /anonymous", (app) => post(app, "/anonymous")],
    ["POST /anonymous/link", async (app) => {
        const guest = await (await post(app, "/anonymous")).json() as SessionBody;
        return post(app, "/anonymous/link", { email: "upgraded@example.com", password: PASSWORD }, {
            Authorization: `Bearer ${guest.tokens.accessToken}`
        });
    }],
    ["POST /mfa/challenge/verify", async (app, store) => {
        const user = await store.repo().createUser({ email: "mfa@example.com", passwordHash: `hashed:${PASSWORD}`, emailVerified: true });
        const { secret } = generateTotpSecret("App", "mfa@example.com");
        const factor = await store.repo().createMfaFactor(user.id, "totp", encryptTotpSecret(secret));
        await store.repo().verifyMfaFactor(factor.id);

        const login = await post(app, "/login", { email: "mfa@example.com", password: PASSWORD });
        const { error } = await login.json() as { error: { details: { mfaToken: string } } };
        const pending = { Authorization: `Bearer ${error.details.mfaToken}` };
        const opened = await post(app, "/mfa/challenge", { factorId: factor.id }, pending);
        const { challengeId } = await opened.json() as { challengeId: string };
        return post(app, "/mfa/challenge/verify", { challengeId, code: generateTotp(base32Decode(secret)) }, pending);
    }]
];

describe("cookieAuth: every door that opens a session", () => {
    it.each(DOORS)("%s delivers the refresh token as a cookie, not in the body", async (_door, open) => {
        const store = new MemoryAuthStore();
        const app = createApp(store);

        const res = await open(app, store);

        expect(res.status).toBeLessThan(300);
        const body = await res.json() as SessionBody;
        expect(body.tokens.accessToken).toEqual(expect.any(String));
        expect(body.tokens.refreshToken).toBe("");
        const cookie = refreshCookie(res);
        expect(cookie).not.toBeNull();

        // What a page reload does in cookie mode: no body, only the cookie.
        const reload = await app.request("/auth/refresh", { method: "POST", headers: { cookie: cookie! } });
        expect(reload.status).toBe(200);
    });

    it("POST /refresh itself answers with a cookie, not a body token", async () => {
        const store = new MemoryAuthStore();
        const app = createApp(store);
        const signedIn = await post(app, "/register", { email: "refresh@example.com", password: PASSWORD });

        const res = await app.request("/auth/refresh", { method: "POST", headers: { cookie: refreshCookie(signedIn)! } });

        expect(res.status).toBe(200);
        expect(((await res.json()) as SessionBody).tokens.refreshToken).toBe("");
        expect(refreshCookie(res)).not.toBeNull();
    });
});
