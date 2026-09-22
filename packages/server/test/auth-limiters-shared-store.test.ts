/**
 * The auth limiters count in the store the deployment configured.
 *
 * `REBASE_RATE_LIMIT_STORE=sql` is documented as where auth rate-limit counters
 * live, and the OTP route's own comment said its per-address budget was
 * "shared with `REBASE_RATE_LIMIT_STORE=sql`". It was wired into the data,
 * functions and storage limiters only. Every auth limiter was a module-level
 * constant built at import time with a private in-memory store, so on N
 * replicas the OTP brute-force limit (5 attempts per address), the MFA limit,
 * and the login, reset and send limits were each enforced per replica — N
 * times looser — while the configuration said otherwise and nothing warned.
 *
 * Booted for real, with the SQL store swapped for one that records what it is
 * asked: the thing under test is the wiring from the setting to the limiters.
 */
import { describe, expect, it, afterEach, beforeEach, jest } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";
import type { RateLimitDecision } from "../src/auth/rate-limit-store";

const mockSharedHits: string[] = [];

jest.mock("../src/auth/sql-rate-limit-store", () => ({
    createSqlRateLimitStore: () => ({
        hit: async (key: string, _windowMs: number, limit: number): Promise<RateLimitDecision> => {
            mockSharedHits.push(key);
            return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
        }
    })
}));

jest.mock("../src/utils/logger", () => ({
    ...jest.requireActual<Record<string, unknown>>("../src/utils/logger"),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

import { initializeRebaseBackend } from "../src/init";

const bootstrapper: BackendBootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return {
            driver: {
                fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
                healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
                admin: { executeSql: async () => [] }
            },
            collections: [],
            internals: {}
        } as unknown as InitializedDriver;
    },
    async initializeAuth() {
        return {
            userService: {},
            authRepository: {
                getUserRoleIds: async () => [],
                getTokensValidAfter: async () => null,
                getUserByEmail: async () => null
            }
        };
    }
} as unknown as BackendBootstrapper;

async function boot(): Promise<Hono> {
    const app = new Hono();
    await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [],
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        auth: { requireAuth: false, jwtSecret: "auth-limiters-shared-store-secret-0123456789", emailOtp: true }
    } as never);
    return app;
}

const post = (app: Hono, path: string, body: unknown) => app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
});

const ORIGINAL = process.env.REBASE_RATE_LIMIT_STORE;

beforeEach(() => {
    mockSharedHits.length = 0;
});

afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.REBASE_RATE_LIMIT_STORE;
    else process.env.REBASE_RATE_LIMIT_STORE = ORIGINAL;
});

describe("with REBASE_RATE_LIMIT_STORE=sql", () => {
    beforeEach(() => {
        process.env.REBASE_RATE_LIMIT_STORE = "sql";
    });

    it("counts the per-address OTP verification budget in the shared store", async () => {
        const app = await boot();

        await post(app, "/api/auth/otp/verify", { email: "Victim@Example.com", code: "000000" });

        expect(mockSharedHits).toContainEqual(expect.stringMatching(/otp-verify:victim@example\.com$/));
    });

    it("counts the per-account MFA verification budget in the shared store", async () => {
        const app = await boot();

        await post(app, "/api/auth/mfa/challenge/verify", { challengeId: "c", code: "000000", factorId: "f" });

        expect(mockSharedHits).toContainEqual(expect.stringMatching(/mfa-verify:/));
    });

    it("counts the per-IP login and sensitive-route budgets there too, in separate buckets", async () => {
        const app = await boot();

        await post(app, "/api/auth/login", { email: "a@example.com", password: "x" });
        await post(app, "/api/auth/forgot-password", { email: "a@example.com" });

        // Two limiters keyed by the same address must not share one count in
        // one store: login's allowance would be spent by password resets.
        const login = mockSharedHits.filter(k => k.includes("auth-default:"));
        const strict = mockSharedHits.filter(k => k.includes("auth-strict:"));
        expect(login.length).toBeGreaterThan(0);
        expect(strict.length).toBeGreaterThan(0);
    });
});

describe("with the default store", () => {
    it("keeps the auth limiters off a store an earlier boot configured", async () => {
        process.env.REBASE_RATE_LIMIT_STORE = "sql";
        await boot();
        delete process.env.REBASE_RATE_LIMIT_STORE;
        const app = await boot();
        mockSharedHits.length = 0;

        await post(app, "/api/auth/otp/verify", { email: "someone@example.com", code: "000000" });

        expect(mockSharedHits).toEqual([]);
    });
});
