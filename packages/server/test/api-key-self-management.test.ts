/**
 * An API key may not manage API keys.
 *
 * `createApiKeyPreAuth` is mounted in front of every `/admin/*` router so that
 * keys created with `admin: true` reach the admin surfaces — cron, logs,
 * backups. On the key-management router that same reach is a privilege
 * escalation: an admin key could mint a second admin key, widen its own grants
 * through `PUT /:id`, or revoke the keys other integrations run on. None of it
 * is undone by revoking the original key, because the keys it minted are
 * ordinary rows with no link back to their creator.
 *
 * These tests pin the rule and its two exemptions: a human admin's JWT and the
 * service key still manage keys, because neither is an API key.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import { createHash } from "crypto";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createApiKeyPreAuth } from "../src/auth/api-keys/api-key-middleware";
import { createApiKeyRoutes } from "../src/auth/api-keys/api-key-routes";
import type { ApiKeyStore } from "../src/auth/api-keys/api-key-store";
import type { ApiKey } from "../src/auth/api-keys/api-key-types";
import type { HonoEnv } from "../src/api/types";
import type { DataDriver } from "@rebasepro/types";

const TEST_SECRET = "test-secret-for-api-key-self-management-1234567890";
const SERVICE_KEY = "service-key-for-api-key-self-management-1234567890";

const ADMIN_KEY_TOKEN = "rk_selfmgmt_admin_token_aaaa";
const SCOPED_KEY_TOKEN = "rk_selfmgmt_scoped_token_bbbb";

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

function makeKey(token: string, overrides: Partial<ApiKey> = {}): ApiKey {
    return {
        id: `id-${token.slice(-4)}`,
        name: "test key",
        key_prefix: token.slice(0, 12),
        key_hash: sha256(token),
        permissions: [],
        admin: false,
        rate_limit: null,
        created_by: "tester",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
        ...overrides
    };
}

const KEYS = [
    makeKey(ADMIN_KEY_TOKEN, { admin: true }),
    makeKey(SCOPED_KEY_TOKEN, { permissions: [{ collection: "events", operations: ["read"] }] })
];

/** A store whose mutating methods are spies, so we can assert they never ran. */
function makeStore() {
    return {
        findByKeyHash: jest.fn(async (hash: string) => KEYS.find((k) => k.key_hash === hash) ?? null),
        updateLastUsed: jest.fn(async () => undefined),
        listApiKeys: jest.fn(async () => []),
        getApiKeyById: jest.fn(async () => null),
        createApiKey: jest.fn(async () => ({ id: "new-key", key: "rk_live_minted" })),
        updateApiKey: jest.fn(async () => null),
        revokeApiKey: jest.fn(async () => true)
    } as unknown as ApiKeyStore & Record<string, jest.Mock>;
}

// A driver without withAuth(): scopeDataDriver passes it through unchanged.
const bareDriver = {} as DataDriver;

/** Mirrors how init.ts wires the pre-auth in front of the key-management router. */
function buildApp(store: ApiKeyStore) {
    const app = new Hono<HonoEnv>();
    app.use("/api/admin/*", createApiKeyPreAuth({ store, driver: bareDriver }));
    app.route("/api/admin/api-keys", createApiKeyRoutes({ store, serviceKey: SERVICE_KEY }));
    return app;
}

beforeAll(() => {
    configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
});

const CREATE_BODY = JSON.stringify({ name: "minted", permissions: [{ collection: "*", operations: ["read", "write", "delete"] }], admin: true });

describe("API keys cannot manage API keys", () => {
    const cases: { label: string; path: string; init: RequestInit }[] = [
        { label: "GET / (list)", path: "/api/admin/api-keys", init: { method: "GET" } },
        { label: "POST / (mint)", path: "/api/admin/api-keys", init: { method: "POST", body: CREATE_BODY, headers: { "content-type": "application/json" } } },
        { label: "GET /:id", path: "/api/admin/api-keys/id-aaaa", init: { method: "GET" } },
        { label: "PUT /:id (self-widen)", path: "/api/admin/api-keys/id-aaaa", init: { method: "PUT", body: JSON.stringify({ admin: true }), headers: { "content-type": "application/json" } } },
        { label: "DELETE /:id (revoke a rival)", path: "/api/admin/api-keys/id-bbbb", init: { method: "DELETE" } }
    ];

    it.each(cases)("refuses an admin API key on $label", async ({ path, init }) => {
        const store = makeStore();
        const res = await buildApp(store).request(path, {
            ...init,
            headers: { ...(init.headers ?? {}), Authorization: `Bearer ${ADMIN_KEY_TOKEN}` }
        });

        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("API_KEY_SELF_MANAGEMENT_FORBIDDEN");

        // The refusal must land before the store — a 403 that still wrote
        // would be a worse bug than the one being fixed.
        expect(store.createApiKey).not.toHaveBeenCalled();
        expect(store.updateApiKey).not.toHaveBeenCalled();
        expect(store.revokeApiKey).not.toHaveBeenCalled();
        expect(store.listApiKeys).not.toHaveBeenCalled();
    });

    it("refuses a non-admin API key with the same reason, not a generic admin gate", async () => {
        // Otherwise the 403 reads as "you need a wider key", which is advice
        // toward the escalation rather than away from it.
        const store = makeStore();
        const res = await buildApp(store).request("/api/admin/api-keys", {
            headers: { Authorization: `Bearer ${SCOPED_KEY_TOKEN}` }
        });

        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("API_KEY_SELF_MANAGEMENT_FORBIDDEN");
    });

    it("still allows the service key to manage keys", async () => {
        const store = makeStore();
        const res = await buildApp(store).request("/api/admin/api-keys", {
            headers: { Authorization: `Bearer ${SERVICE_KEY}` }
        });

        expect(res.status).toBe(200);
        expect(store.listApiKeys).toHaveBeenCalled();
    });

    it("still allows an admin user's JWT to manage keys", async () => {
        const store = makeStore();
        const token = await generateAccessToken("admin-user", ["admin"]);
        const res = await buildApp(store).request("/api/admin/api-keys", {
            headers: { Authorization: `Bearer ${token}` }
        });

        expect(res.status).toBe(200);
        expect(store.listApiKeys).toHaveBeenCalled();
    });

    it("still allows an admin user's JWT to mint a key", async () => {
        const store = makeStore();
        const token = await generateAccessToken("admin-user", ["admin"]);
        const res = await buildApp(store).request("/api/admin/api-keys", {
            method: "POST",
            body: CREATE_BODY,
            headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }
        });

        expect(res.status).toBe(201);
        expect(store.createApiKey).toHaveBeenCalled();
    });
});
