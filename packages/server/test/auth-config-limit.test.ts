/**
 * `GET /auth/config` counts in a bucket of its own.
 *
 * The admin app reads it twice on every page load, before anyone signs in. It
 * shared the login limiter (200 per address per 15 minutes), so a hundred page
 * loads from one office address — one NAT, everybody behind it — spent the
 * whole login allowance and every sign-in there answered 429.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import { createServer } from "node:http";
import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";

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
            driver: fakeDataDriver({
                fetchCollection: async () => [],
                admin: { executeSql: async () => [] }
            }),
            collections: [],
            internals: {}
        };
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
};

async function boot(): Promise<Hono<HonoEnv>> {
    const app = new Hono<HonoEnv>();
    await initializeRebaseBackend({
        app,
        // Never listened on: the backend only attaches its websocket to it.
        server: createServer(),
        collections: [],
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        auth: { requireAuth: false, jwtSecret: "auth-config-limit-secret-0123456789-abcdef" }
    });
    return app;
}

describe("GET /auth/config rate limit", () => {
    it("is not counted in the login budget", async () => {
        const app = await boot();

        // More than the whole login allowance, from one address.
        for (let i = 0; i < 250; i++) {
            const res = await app.request("/api/auth/config");
            expect(res.status).toBe(200);
        }

        const login = await app.request("/api/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "a@example.com", password: "x" })
        });
        expect(login.status).not.toBe(429);
        expect(login.headers.get("X-RateLimit-Limit")).toBe("200");
        expect(login.headers.get("X-RateLimit-Remaining")).toBe("199");
    });

    it("is still bounded, far above what browsing reaches", async () => {
        const app = await boot();

        const res = await app.request("/api/auth/config");

        expect(res.headers.get("X-RateLimit-Limit")).toBe("3000");
    });
});
