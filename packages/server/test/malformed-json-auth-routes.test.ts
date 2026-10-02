/**
 * A body that is not JSON is the caller's mistake, on every route.
 *
 * The auth and admin routes read their bodies with `c.req.json()`, which
 * throws a `SyntaxError` on `{"email":` — and that reached the error handler
 * as a 500 "Internal Server Error", logged at ERROR with a stack, on login,
 * register, forgot-password, magic link, every verify and `/admin/users`. The
 * data API, which parses its own body, already answered 400.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

beforeAll(() => configureJwt({ secret: "malformed-json-auth-routes-secret-0123456789", accessExpiresIn: "1h" }));

describe("a malformed JSON body", () => {
    const store = new MemoryAuthStore();
    const adapter = createBuiltinAuthAdapter({ authRepository: store.repo(), allowRegistration: true, enableMagicLink: true, enableEmailOtp: true });
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", adapter.createAuthRoutes() as Hono<HonoEnv>);
    app.route("/admin", adapter.createAdminRoutes!() as Hono<HonoEnv>);

    const routes = [
        "/auth/login", "/auth/register", "/auth/forgot-password", "/auth/reset-password",
        "/auth/magic-link/verify", "/auth/otp/verify", "/auth/verify-email", "/admin/users"
    ];

    it.each(routes)("answers 400 INVALID_JSON on %s, not 500", async (path) => {
        const admin = await store.repo().createUser({ email: `admin-${Math.random()}@corp.com`, emailVerified: true });
        await store.repo().setUserRoles(admin.id, ["admin"]);
        const res = await app.request(path, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${await generateAccessToken(admin.id, ["admin"])}` },
            body: "{\"email\":"
        });
        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_JSON");
    });
});
