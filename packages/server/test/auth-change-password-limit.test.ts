/**
 * `/change-password` is throttled per account.
 *
 * The current password is the one thing a stolen access token does not carry,
 * and the route that checks it is the route that then signs every other
 * device out. Unthrottled, a token holder could put guesses to it as fast as
 * the hash answered for as long as the token lived — and, on the right one,
 * lock the owner out. The budget is the account's, not the address's: the
 * token can be replayed from anywhere.
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

const SECRET = "auth-change-password-limit-secret-at-least-32-chars";
const PASSWORD = "Str0ng-Passw0rd!";

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => {
    configureJwt({ secret: SECRET, accessExpiresIn: "1h" });
});

function post(app: Hono<HonoEnv>, path: string, body: Record<string, unknown>, token?: string) {
    return Promise.resolve(app.request(`/auth${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
    }));
}

async function signIn(app: Hono<HonoEnv>, email: string): Promise<string> {
    const res = await post(app, "/login", { email, password: PASSWORD });
    expect(res.status).toBe(200);
    return (await res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

describe("POST /auth/change-password", () => {
    it("stops guessing at one account's password without stopping another", async () => {
        const store = new MemoryAuthStore();
        for (const email of ["victim@example.com", "other@example.com"]) {
            await store.repo().createUser({ email, passwordHash: `hashed:${PASSWORD}`, emailVerified: true });
        }
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/auth", createAuthRoutes({ authRepo: store.repo(), authHooks: HOOKS }));

        const stolen = await signIn(app, "victim@example.com");
        const statuses: number[] = [];
        for (let guess = 0; guess < 12; guess++) {
            statuses.push((await post(app, "/change-password", {
                oldPassword: `Guess-${guess}-Passw0rd`,
                newPassword: "Attack3r-Chosen!"
            }, stolen)).status);
        }

        expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
        expect(statuses.slice(10)).toEqual([429, 429]);

        // The right password, inside the exhausted window, is refused too.
        const correct = await post(app, "/change-password", {
            oldPassword: PASSWORD,
            newPassword: "Attack3r-Chosen!"
        }, stolen);
        expect(correct.status).toBe(429);

        // Another account's budget is its own.
        const other = await signIn(app, "other@example.com");
        const res = await post(app, "/change-password", {
            oldPassword: PASSWORD,
            newPassword: "N3w-Passw0rd-Other"
        }, other);
        expect(res.status).toBe(200);
    });
});
