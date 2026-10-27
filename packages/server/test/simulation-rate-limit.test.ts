/**
 * Simulating or impersonating someone is the administrator's traffic, and is
 * charged to the administrator's rate-limit budget — never the target's.
 *
 * `applySimulation` and `applyImpersonation` put the target in `user` (and a
 * simulated key in `apiKey`), and the data limiter bucketed by those. An admin
 * browsing "Simulate access → API key" spent a production integration's
 * `rate_limit`, and the integration, presenting its own key, got 429; the same
 * for a simulated or impersonated user's personal allowance.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { Hono } from "hono";
import type { AuthAdapter, AuthenticatedUser, DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { createDataRateLimiter } from "../src/auth/rate-limiter";
import { sha256Hex } from "../src/utils/portable-crypto";
import type { ApiKeyStore } from "../src/auth/api-keys/api-key-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const driver = { key: "d", initialised: true, withAuth: async () => driver } as unknown as DataDriver;
const people: Record<string, AuthenticatedUser> = {
    "admin-1": { uid: "admin-1", roles: ["admin"], isAdmin: true } as AuthenticatedUser,
    "u_1": { uid: "u_1", roles: ["customer"], isAdmin: false } as AuthenticatedUser
};
const tokens: Record<string, string> = { "admin-token": "admin-1", "u1-token": "u_1" };
const adapter = {
    id: "fake",
    verifyRequest: async (req: Request) => {
        const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        return tokens[token] ? people[tokens[token]] : null;
    },
    resolveUser: async (uid: string) => people[uid] ?? null
} as unknown as AuthAdapter;

const PLAINTEXT = "rk_live_integration_key_0123456789";
const key = {
    id: "key-1", name: "integration", kind: "service", key_prefix: "rk_live_inte", scopes: ["data:read"], roles: [],
    owner_uid: null, rate_limit: 3, created_by: "admin-1", created_at: "", updated_at: "", last_used_at: null,
    expires_at: null, revoked_at: null
};

async function build() {
    const hash = await sha256Hex(PLAINTEXT);
    const store = {
        findByKeyHash: async (h: string) => (h === hash ? { ...key, key_hash: hash } : null),
        getApiKeyById: async (id: string) => (id === key.id ? key : null),
        updateLastUsed: async () => undefined
    } as unknown as ApiKeyStore;
    const app = new Hono<HonoEnv>();
    app.use("/*", createAdapterAuthMiddleware({ adapter, driver, apiKeyStore: store }));
    app.use("/*", createDataRateLimiter({ apiKey: 1000, user: 3, anonymous: 300 }));
    app.get("/posts", (c) => c.json({ ok: true }));
    return app;
}

const asAdmin = (header: Record<string, string>) => ({ headers: { Authorization: "Bearer admin-token", ...header } });

describe("the data limiter under simulation and impersonation", () => {
    it.each([
        ["simulating a key", { "x-rebase-simulate-api-key-id": "key-1" }, { Authorization: `Bearer ${PLAINTEXT}` }],
        ["simulating a user", { "x-rebase-simulate-user-id": "u_1" }, { Authorization: "Bearer u1-token" }],
        ["impersonating a user", { "x-rebase-impersonate": "u_1" }, { Authorization: "Bearer u1-token" }]
    ])("charges %s to the administrator, not the target", async (_label, header, target) => {
        const app = await build();
        for (let i = 0; i < 3; i++) {
            expect((await app.request("/posts", asAdmin(header))).status).toBe(200);
        }
        // The target, presenting its own credential, still has its whole budget.
        expect((await app.request("/posts", { headers: target })).status).toBe(200);
        // The administrator's own budget is what was spent.
        expect((await app.request("/posts", asAdmin({}))).status).toBe(429);
        expect((await app.request("/posts", asAdmin(header))).status).toBe(429);
    });
});
