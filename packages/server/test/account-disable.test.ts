/**
 * An administrator can switch an account off without deleting it.
 *
 * There was no such thing: `beforeLogin` was the documented lockout, it ran on
 * password sign-in alone, and nothing reached a refresh token, which slides
 * for 400 days. "Deleting an account is how an administrator bans one" was
 * the advice. `PUT /admin/users/:uid { disabled: true }` now refuses every
 * sign-in door, refresh, and every token the account already holds.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { oauthCodeFlowSchema } from "../src/auth/oauth-code-flow";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const EMAIL = "member@corp.com";
const PASSWORD = "Passw0rd-Member";

beforeAll(() => configureJwt({ secret: "account-disable-secret-at-least-32-chars", accessExpiresIn: "1h" }));

async function world() {
    const store = new MemoryAuthStore();
    const adapter = createBuiltinAuthAdapter({
        authRepository: store.repo(),
        allowRegistration: true,
        authHooks: {
            hashPassword: async (password: string) => `hashed:${password}`,
            verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
        },
        oauthProviders: [{
            id: "google",
            schema: oauthCodeFlowSchema(),
            verify: async () => ({ providerId: "g-member", email: EMAIL, emailVerified: true })
        }]
    });
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", adapter.createAuthRoutes() as Hono<HonoEnv>);
    app.route("/admin", adapter.createAdminRoutes!() as Hono<HonoEnv>);
    app.get("/data", async (c) => (await adapter.verifyRequest(c.req.raw)) ? c.json({ ok: true }) : c.json({}, 401));
    const call = async (method: string, path: string, body?: unknown, token?: string) => {
        const res = await app.request(path, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : {} };
    };
    const admin = await store.repo().createUser({ email: "admin@corp.com", emailVerified: true });
    await store.repo().setUserRoles(admin.id, ["admin"]);
    const adminToken = await generateAccessToken(admin.id, ["admin"]);
    const member = await call("POST", "/auth/register", { email: EMAIL, password: PASSWORD });
    return { store, call, adminToken, adminId: admin.id, member: member.json as { user: { uid: string }; tokens: { accessToken: string; refreshToken: string } } };
}

describe("PUT /admin/users/:uid { disabled }", () => {
    it("refuses every way in while off, and lets the account back when on", async () => {
        const { store, call, adminToken, member } = await world();
        const uid = member.user.uid;
        // Verified, so Google links onto it rather than refusing for that.
        store.users.get(uid)!.emailVerified = true;

        const off = await call("PUT", `/admin/users/${uid}`, { disabled: true }, adminToken);
        expect(off.status).toBe(200);
        expect(off.json.user.disabled).toBe(true);

        expect((await call("GET", "/data", undefined, member.tokens.accessToken)).status).toBe(401);
        expect((await call("POST", "/auth/refresh", { refreshToken: member.tokens.refreshToken })).status).toBe(401);
        expect((await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD })).json.error.code).toBe("ACCOUNT_DISABLED");
        expect((await call("POST", "/auth/google", { code: "c", redirectUri: "https://app.test/cb" })).json.error.code).toBe("ACCOUNT_DISABLED");
        // A wrong password does not learn that the account is disabled.
        expect((await call("POST", "/auth/login", { email: EMAIL, password: "wrong" })).json.error.code).toBe("INVALID_CREDENTIALS");

        const on = await call("PUT", `/admin/users/${uid}`, { disabled: false }, adminToken);
        expect(on.json.user.disabled).toBe(false);
        expect((await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD })).status).toBe(200);
    });

    it("holds on its own, without the sessions it ends: a flag set in the database alone", async () => {
        // Disabling also ends every session; this is the account flagged with
        // nothing ended — a row edited by hand, a restore — and the flag alone
        // refuses the token and the refresh.
        const { store, call, member } = await world();
        store.users.get(member.user.uid)!.disabled = true;

        expect((await call("GET", "/data", undefined, member.tokens.accessToken)).status).toBe(401);
        expect((await call("POST", "/auth/refresh", { refreshToken: member.tokens.refreshToken })).json.error.code).toBe("ACCOUNT_DISABLED");
    });

    it("cannot switch off the caller's own account", async () => {
        const { call, adminToken, adminId } = await world();
        expect((await call("PUT", `/admin/users/${adminId}`, { disabled: true }, adminToken)).json.error.code).toBe("SELF_DISABLE");
    });

    it("needs users:write", async () => {
        const { store, call, member } = await world();
        const editor = await store.repo().createUser({ email: "editor@corp.com", emailVerified: true });
        await store.repo().setUserRoles(editor.id, ["editor"]);
        const res = await call("PUT", `/admin/users/${member.user.uid}`, { disabled: true }, await generateAccessToken(editor.id, ["editor"]));
        expect(res.status).toBe(403);
        expect([...store.users.values()].find(u => u.id === member.user.uid)?.disabled).toBeFalsy();
    });
});
