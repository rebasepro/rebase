/**
 * Upgrading a guest is registration, and gets registration's controls.
 *
 * `POST /auth/anonymous` makes a guest: a session without an account, which
 * apps mint on page load, so it deliberately carries no challenge.
 * `POST /auth/anonymous/link` then puts an email and a password on that guest,
 * and from then on it is an account like any `POST /auth/register` makes. The
 * two in a row were a registration door with neither the register captcha nor
 * the `beforeUserCreate` check on the address: a bot with no challenge solved
 * ended up with a working password account for an address the deployment's own
 * rule refuses.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { ApiError, errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { CaptchaVerifier } from "../src/auth/captcha";
import { oauthCodeFlowSchema } from "../src/auth/oauth-code-flow";
import { configureJwt } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const PASSWORD = "Str0ng-Passw0rd!";

/** A challenge the test can solve: the token "solved" verifies, nothing else does. */
const verifyCaptcha: CaptchaVerifier = async ({ token }) => ({ success: token === "solved" });

/** Guests pass; an account must be on the company's domain. */
const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`,
    beforeUserCreate: async (data) => {
        if (data.isAnonymous === true) return data;
        if (!data.email.endsWith("@corp.com")) {
            throw ApiError.forbidden("Only company addresses may sign up", "SIGNUP_REFUSED");
        }
        return { ...data, displayName: data.email.split("@")[0] };
    }
};

beforeAll(() => configureJwt({ secret: "anonymous-link-registration-secret-32-chars!!", accessExpiresIn: "1h" }));

function world(allowRegistration = true) {
    const store = new MemoryAuthStore();
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        authHooks: HOOKS,
        allowRegistration,
        allowAnonymous: true,
        captcha: { enabled: true, verify: verifyCaptcha, routes: ["register"] }
    }));
    const post = (path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) =>
        Promise.resolve(app.request(`/auth${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: body === undefined ? undefined : JSON.stringify(body)
        }));
    const guest = async () => {
        const res = await post("/anonymous");
        expect(res.status).toBe(201);
        const body = await res.json() as { user: { uid: string }; tokens: { accessToken: string } };
        return { uid: body.user.uid, auth: { Authorization: `Bearer ${body.tokens.accessToken}` } };
    };
    return { store, post, guest };
}

describe("POST /auth/anonymous/link is registration", () => {
    it("is refused while registration is closed, guests or no guests", async () => {
        const { store, post } = world(false);
        // A user exists, so the empty-table exception does not apply.
        await store.repo().createUser({ email: "existing@corp.com" });
        const guestRes = await post("/anonymous");
        expect(guestRes.status).toBe(201);
        const { tokens } = await guestRes.json() as { tokens: { accessToken: string } };

        const res = await post("/anonymous/link", { email: "upgraded@corp.com", password: "Passw0rd-Guest", captchaToken: "solved" }, {
            Authorization: `Bearer ${tokens.accessToken}`
        });

        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("REGISTRATION_DISABLED");
        expect([...store.users.values()].some(u => u.email === "upgraded@corp.com")).toBe(false);
    });

    it("asks for the register challenge, which the guest sign-in before it does not", async () => {
        const { store, post, guest } = world();
        const { uid, auth } = await guest();

        const unsolved = await post("/anonymous/link", { email: "someone@corp.com", password: PASSWORD }, auth);

        expect(unsolved.status).toBe(400);
        expect((await unsolved.json() as { error: { code: string } }).error.code).toBe("CAPTCHA_REQUIRED");
        expect(store.users.get(uid)?.isAnonymous).toBe(true);
        expect(store.users.get(uid)?.passwordHash).toBeNull();

        const solved = await post("/anonymous/link", { email: "someone@corp.com", password: PASSWORD, captchaToken: "solved" }, auth);

        expect(solved.status).toBe(200);
        expect(store.users.get(uid)?.isAnonymous).toBe(false);
    });

    it("runs beforeUserCreate on the address the account is getting", async () => {
        const { store, post, guest } = world();
        const { uid, auth } = await guest();

        const refused = await post("/anonymous/link", { email: "bot@evil.com", password: PASSWORD, captchaToken: "solved" }, auth);

        expect(refused.status).toBe(403);
        expect((await refused.json() as { error: { code: string } }).error.code).toBe("SIGNUP_REFUSED");
        // Still a guest: no address, no password, nothing to sign in with.
        expect(store.users.get(uid)?.isAnonymous).toBe(true);
        expect(store.users.get(uid)?.passwordHash).toBeNull();
        expect(store.users.get(uid)?.email).not.toBe("bot@evil.com");
    });

    it("stores what the hook returns, as registration does", async () => {
        const { store, post, guest } = world();
        const { uid, auth } = await guest();

        const res = await post("/anonymous/link", { email: "person@corp.com", password: PASSWORD, captchaToken: "solved" }, auth);

        expect(res.status).toBe(200);
        expect(store.users.get(uid)).toMatchObject({
            email: "person@corp.com",
            passwordHash: `hashed:${PASSWORD}`,
            displayName: "person",
            isAnonymous: false
        });
    });
});

/**
 * Linking a provider to a guest makes it an account, as linking a password
 * does. It used to answer success and leave a guest: `/me` still said
 * `isAnonymous: true` with the synthetic address, and every later sign-in with
 * that provider returned the guest.
 */
describe("POST /auth/link/:provider on a guest", () => {
    function oauthWorld(allowRegistration: boolean) {
        const store = new MemoryAuthStore();
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/auth", createAuthRoutes({
            authRepo: store.repo(),
            authHooks: HOOKS,
            allowRegistration,
            allowAnonymous: true,
            oauthProviders: [{
                id: "google",
                schema: oauthCodeFlowSchema(),
                verify: async () => ({ providerId: "g-guest", email: "Guest.Person@corp.com", emailVerified: true })
            }]
        }));
        const post = async (path: string, body: unknown, token?: string) => {
            const res = await app.request(`/auth${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify(body)
            });
            return { status: res.status, json: await res.json() as Record<string, any> };
        };
        return { store, post };
    }

    it("upgrades it: no longer a guest, the provider's address, and a session that says so", async () => {
        const { post } = oauthWorld(true);
        const guest = await post("/anonymous", {});

        const linked = await post("/link/google", { code: "c", redirectUri: "https://app.test/cb" }, guest.json.tokens.accessToken);

        expect(linked.status).toBe(200);
        expect(linked.json.user).toMatchObject({ isAnonymous: false, email: "guest.person@corp.com", emailVerified: true });
        const again = await post("/google", { code: "c", redirectUri: "https://app.test/cb" });
        expect(again.json.user).toMatchObject({ uid: guest.json.user.uid, isAnonymous: false });
    });

    it("is refused while registration is closed", async () => {
        const { store, post } = oauthWorld(false);
        await store.repo().createUser({ email: "existing@corp.com" });
        const guest = await post("/anonymous", {});
        const linked = await post("/link/google", { code: "c", redirectUri: "https://app.test/cb" }, guest.json.tokens.accessToken);
        expect(linked.json.error.code).toBe("REGISTRATION_DISABLED");
        expect(store.providersOf(guest.json.user.uid)).toEqual([]);
    });
});
