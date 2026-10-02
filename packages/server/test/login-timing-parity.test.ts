/**
 * `POST /auth/login` must not say by its timing whether an address has an
 * account. It refused an unknown address before any key derivation and a
 * known one after scrypt — 2-4 ms against 36-47 ms — while `/forgot-password`,
 * `/magic-link` and `/otp` are held to a floor so they do not answer that.
 * Both branches now pay one `verifyPassword`.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import { configureJwt } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

beforeAll(() => configureJwt({ secret: "login-timing-parity-secret-at-least-32", accessExpiresIn: "1h" }));

describe("POST /auth/login on an address with no password to check", () => {
    it.each([
        ["no account", async () => undefined],
        ["an account without a password", async (store: MemoryAuthStore) => { await store.repo().createUser({ email: "oauth-only@corp.com" }); }]
    ])("verifies a password all the same: %s", async (_case, seed) => {
        const store = new MemoryAuthStore();
        await seed(store);
        const verifyPassword = jest.fn(async (password: string, stored: string) => stored === `hashed:${password}`);
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/auth", createAuthRoutes({
            authRepo: store.repo(),
            authHooks: { hashPassword: async (password: string) => `hashed:${password}`, verifyPassword }
        }));

        const res = await app.request("/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "oauth-only@corp.com", password: "Guess-Passw0rd" })
        });

        expect(res.status).toBe(401);
        expect(verifyPassword).toHaveBeenCalledTimes(1);
    });
});
