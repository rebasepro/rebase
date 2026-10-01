/**
 * The two key-management routers: who may manage keys, and what a new key
 * may hold.
 *
 * Three rules, each pinned in both directions:
 *
 * - **An API key never manages API keys** — not a service key, not a personal
 *   key, whatever it holds. A key that could would mint its own successor,
 *   widen itself or revoke the keys other integrations run on, and revoking it
 *   would undo none of that.
 * - **Nothing is minted with more than its minter holds** — its scopes, and
 *   for a service key its RLS roles.
 * - **`keys:*` never goes on a key.**
 */
import { describe, it, expect, beforeAll, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import { createHash } from "crypto";
import { EMPTY_ACCESS_MODEL, type AccessModel } from "@rebasepro/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { configureAccess } from "../src/auth/access";
import { createApiKeyPreAuth } from "../src/auth/api-keys/api-key-middleware";
import { createApiKeyRoutes, createPersonalKeyRoutes } from "../src/auth/api-keys/api-key-routes";
import type { ApiKeyStore } from "../src/auth/api-keys/api-key-store";
import type { ApiKey } from "../src/auth/api-keys/api-key-types";
import type { KeyTargets } from "../src/auth/api-keys/key-grant";
import type { HonoEnv } from "../src/api/types";
import type { DataDriver } from "@rebasepro/types";

const TEST_SECRET = "test-secret-for-api-key-self-management-1234567890";
const SERVICE_KEY = "service-key-for-api-key-self-management-1234567890";

const WIDE_KEY_TOKEN = "rk_selfmgmt_wide_token_aaaa";
const SCOPED_KEY_TOKEN = "rk_selfmgmt_scoped_token_bbbb";
const PERSONAL_KEY_TOKEN = "rk_selfmgmt_personal_token_cccc";

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

function makeKey(token: string, overrides: Partial<ApiKey> = {}): ApiKey {
    return {
        id: `id-${token.slice(-4)}`,
        name: "test key",
        kind: "service",
        key_prefix: token.slice(0, 12),
        key_hash: sha256(token),
        scopes: [],
        roles: [],
        owner_uid: null,
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
    // Holds every admin-plane scope a key can hold, and runs as admin.
    makeKey(WIDE_KEY_TOKEN, {
        scopes: ["data:read", "users:read", "users:write", "logs:read", "schema:read", "schema:write"],
        roles: ["admin"]
    }),
    makeKey(SCOPED_KEY_TOKEN, { scopes: ["data:read:events"] }),
    makeKey(PERSONAL_KEY_TOKEN, { kind: "personal", owner_uid: "owner-1", scopes: ["data:read"] })
];

/** A store whose mutating methods are spies, so we can assert they never ran. */
function makeStore() {
    return {
        findByKeyHash: jest.fn(async (hash: string) => KEYS.find((k) => k.key_hash === hash) ?? null),
        updateLastUsed: jest.fn(async () => undefined),
        listApiKeys: jest.fn(async () => []),
        getApiKeyById: jest.fn(async () => null),
        createApiKey: jest.fn(async (key: object) => ({ ...key, id: "new-key", key: "rk_live_minted" })),
        updateApiKey: jest.fn(async () => null),
        revokeApiKey: jest.fn(async () => true)
    } as unknown as ApiKeyStore & Record<string, jest.Mock>;
}

// A driver without withAuth(): scopeDataDriver passes it through unchanged.
const bareDriver = {} as DataDriver;

const TARGETS: KeyTargets = {
    collections: () => ["posts", "events"],
    functions: () => ["send-email"],
    buckets: () => ["default", "media"]
};

/** Mirrors how init.ts wires the pre-auth in front of both routers. */
function buildApp(store: ApiKeyStore, personalKeys = false) {
    const app = new Hono<HonoEnv>();
    const preAuth = createApiKeyPreAuth({ store, driver: bareDriver });
    app.use("/api/admin/*", preAuth);
    app.route("/api/admin/api-keys", createApiKeyRoutes({ store, serviceKey: SERVICE_KEY, targets: TARGETS }));
    const personal = new Hono<HonoEnv>();
    personal.use("/*", preAuth);
    personal.route("/", createPersonalKeyRoutes({ store, enabled: personalKeys, serviceKey: SERVICE_KEY, targets: TARGETS }));
    app.route("/api/auth/keys", personal);
    return app;
}

const MODEL: AccessModel = {
    roles: {
        keymaster: { scopes: ["keys:read", "keys:write", "logs:read"] },
        auditor: { scopes: ["keys:read"] }
    },
    scopes: { "project:deploy": { label: "Deploy projects", target: "project" } }
};

beforeAll(() => {
    configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
});

afterEach(() => configureAccess({ model: EMPTY_ACCESS_MODEL }));

const json = (body: unknown, token: string): RequestInit => ({
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }
});

describe("API keys cannot manage API keys", () => {
    const CREATE_BODY = JSON.stringify({ name: "minted", scopes: ["data:read"] });
    const cases: { label: string; path: string; init: RequestInit }[] = [
        { label: "GET / (list)", path: "/api/admin/api-keys", init: { method: "GET" } },
        { label: "POST / (mint)", path: "/api/admin/api-keys", init: { method: "POST", body: CREATE_BODY, headers: { "content-type": "application/json" } } },
        { label: "GET /:id", path: "/api/admin/api-keys/id-aaaa", init: { method: "GET" } },
        { label: "PUT /:id (self-widen)", path: "/api/admin/api-keys/id-aaaa", init: { method: "PUT", body: JSON.stringify({ scopes: ["data:read", "data:write"] }), headers: { "content-type": "application/json" } } },
        { label: "DELETE /:id (revoke a rival)", path: "/api/admin/api-keys/id-bbbb", init: { method: "DELETE" } },
        { label: "POST /auth/keys (mint a personal key)", path: "/api/auth/keys", init: { method: "POST", body: CREATE_BODY, headers: { "content-type": "application/json" } } }
    ];

    it.each(cases)("refuses a wide service key on $label", async ({ path, init }) => {
        const store = makeStore();
        const res = await buildApp(store, true).request(path, {
            ...init,
            headers: { ...(init.headers ?? {}), Authorization: `Bearer ${WIDE_KEY_TOKEN}` }
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

    it("refuses a narrow key with the same reason, not a missing scope", async () => {
        // A missing-scope answer would read as "you need a wider key", which is
        // advice toward the escalation rather than away from it.
        const store = makeStore();
        const res = await buildApp(store).request("/api/admin/api-keys", {
            headers: { Authorization: `Bearer ${SCOPED_KEY_TOKEN}` }
        });

        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("API_KEY_SELF_MANAGEMENT_FORBIDDEN");
    });

    it("refuses a personal key on its owner's own routes", async () => {
        configureAccess({ model: EMPTY_ACCESS_MODEL, resolveKeyOwner: async () => ({ roles: [] }) });
        const store = makeStore();
        const res = await buildApp(store, true).request("/api/auth/keys", {
            headers: { Authorization: `Bearer ${PERSONAL_KEY_TOKEN}` }
        });
        expect(res.status).toBe(403);
        expect(store.listApiKeys).not.toHaveBeenCalled();
    });

    it("allows the service key to manage keys", async () => {
        const store = makeStore();
        const res = await buildApp(store).request("/api/admin/api-keys", {
            headers: { Authorization: `Bearer ${SERVICE_KEY}` }
        });

        expect(res.status).toBe(200);
        expect(store.listApiKeys).toHaveBeenCalledWith({ kind: "service" });
    });

    it("allows an admin's JWT to mint a key", async () => {
        const store = makeStore();
        const token = await generateAccessToken("admin-user", ["admin"]);
        const res = await buildApp(store).request("/api/admin/api-keys", json({ name: "minted", scopes: ["data:read", "logs:read"], roles: ["admin"] }, token));

        expect(res.status).toBe(201);
        expect(store.createApiKey).toHaveBeenCalledWith(expect.objectContaining({
            kind: "service", scopes: ["data:read", "logs:read"], roles: ["admin"], owner_uid: null
        }), "admin-user");
    });
});

describe("what a service key may hold", () => {
    const mint = async (body: unknown, roles: string[]) => {
        configureAccess({ model: MODEL });
        const store = makeStore();
        const token = await generateAccessToken("minter", roles);
        const res = await buildApp(store).request("/api/admin/api-keys", json(body, token));
        return { res, store, body: await res.json() as { error?: { code: string; details?: Record<string, unknown> } } };
    };

    it("needs keys:write to mint, and keys:read is enough to list", async () => {
        configureAccess({ model: MODEL });
        const store = makeStore();
        const token = await generateAccessToken("auditor-1", ["auditor"]);
        const app = buildApp(store);
        expect((await app.request("/api/admin/api-keys", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
        const minted = await app.request("/api/admin/api-keys", json({ name: "k", scopes: ["data:read"] }, token));
        expect(minted.status).toBe(403);
        expect((await minted.json() as { error: { code: string } }).error.code).toBe("SCOPE_MISSING");
        expect(store.createApiKey).not.toHaveBeenCalled();
    });

    it("lets a non-admin with keys:write mint within their own scopes", async () => {
        const { res, store } = await mint({ name: "k", scopes: ["data:read:posts", "logs:read", "project:deploy:p1"] }, ["keymaster"]);
        expect(res.status).toBe(201);
        expect(store.createApiKey).toHaveBeenCalled();
    });

    it("refuses a scope beyond the minter", async () => {
        const { res, body, store } = await mint({ name: "k", scopes: ["data:read", "users:write"] }, ["keymaster"]);
        expect(res.status).toBe(403);
        expect(body.error?.code).toBe("SCOPE_EXCEEDS_CREATOR");
        expect(body.error?.details?.scopes).toEqual(["users:write"]);
        expect(store.createApiKey).not.toHaveBeenCalled();
    });

    it("refuses keys:* even to an admin", async () => {
        const { res, body } = await mint({ name: "k", scopes: ["keys:write"] }, ["admin"]);
        expect(res.status).toBe(400);
        expect(body.error?.code).toBe("KEY_MANAGEMENT_SCOPE");
    });

    it("refuses an RLS role the minter does not hold", async () => {
        const { res, body } = await mint({ name: "k", scopes: ["data:read"], roles: ["admin"] }, ["keymaster"]);
        expect(res.status).toBe(403);
        expect(body.error?.code).toBe("ROLE_EXCEEDS_CREATOR");
    });

    it("lets an admin give any RLS role", async () => {
        const { res } = await mint({ name: "k", scopes: ["data:read"], roles: ["editor"] }, ["admin"]);
        expect(res.status).toBe(201);
    });

    it.each([
        [["data:read:nope"], "UNKNOWN_SCOPE_TARGET"],
        [["storage:write:archive"], "UNKNOWN_SCOPE_TARGET"],
        [["functions:invoke:missing"], "UNKNOWN_SCOPE_TARGET"],
        [["logs:read:server"], "INVALID_SCOPES"],
        [["deploy"], "INVALID_SCOPES"],
        [["nothing:here"], "INVALID_SCOPES"]
    ])("refuses %j with 400 %s", async (scopes, code) => {
        const { res, body } = await mint({ name: "k", scopes }, ["admin"]);
        expect(res.status).toBe(400);
        expect(body.error?.code).toBe(code);
    });

    it("refuses an empty scope list", async () => {
        const { res } = await mint({ name: "k", scopes: [] }, ["admin"]);
        expect(res.status).toBe(400);
    });

    it("holds an update to the same rules", async () => {
        configureAccess({ model: MODEL });
        const store = makeStore();
        const token = await generateAccessToken("minter", ["keymaster"]);
        const res = await buildApp(store).request("/api/admin/api-keys/id-bbbb", {
            method: "PUT",
            body: JSON.stringify({ scopes: ["schema:write"] }),
            headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }
        });
        expect(res.status).toBe(403);
        expect(store.updateApiKey).not.toHaveBeenCalled();
    });
});

describe("personal keys", () => {
    it("explain how to switch them on when they are off", async () => {
        const token = await generateAccessToken("u1", []);
        const res = await buildApp(makeStore(), false).request("/api/auth/keys", { headers: { Authorization: `Bearer ${token}` } });
        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string; message: string } }).error).toEqual(expect.objectContaining({
            code: "PERSONAL_KEYS_DISABLED",
            message: expect.stringContaining("personalKeys: true")
        }));
    });

    it("are minted for the caller, as the caller, within the caller's scopes", async () => {
        configureAccess({ model: MODEL });
        const store = makeStore();
        const token = await generateAccessToken("u1", ["keymaster"]);
        const res = await buildApp(store, true).request("/api/auth/keys", json({ name: "laptop", scopes: ["data:read", "logs:read"] }, token));
        expect(res.status).toBe(201);
        expect(store.createApiKey).toHaveBeenCalledWith(expect.objectContaining({
            kind: "personal", owner_uid: "u1", scopes: ["data:read", "logs:read"], roles: [], rate_limit: null
        }), "u1");
    });

    it("refuse a scope the caller does not hold", async () => {
        const store = makeStore();
        const token = await generateAccessToken("u1", ["editor"]);
        const res = await buildApp(store, true).request("/api/auth/keys", json({ name: "laptop", scopes: ["logs:read"] }, token));
        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("SCOPE_EXCEEDS_CREATOR");
        expect(store.createApiKey).not.toHaveBeenCalled();
    });

    it.each([["roles", { roles: ["admin"] }], ["rate_limit", { rate_limit: 100000 }]])(
        "refuse a %s of their own", async (_label, extra) => {
            const token = await generateAccessToken("u1", []);
            const res = await buildApp(makeStore(), true).request("/api/auth/keys", json({ name: "laptop", scopes: ["data:read"], ...extra }, token));
            expect(res.status).toBe(400);
        });

    it("list and revoke only the caller's own", async () => {
        const store = makeStore();
        const token = await generateAccessToken("u1", []);
        const app = buildApp(store, true);
        await app.request("/api/auth/keys", { headers: { Authorization: `Bearer ${token}` } });
        expect(store.listApiKeys).toHaveBeenCalledWith({ kind: "personal", owner_uid: "u1" });
        await app.request("/api/auth/keys/someone-elses", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
        expect(store.revokeApiKey).toHaveBeenCalledWith("someone-elses", "u1");
    });

    it("are refused to the service key, which has no account", async () => {
        const res = await buildApp(makeStore(), true).request("/api/auth/keys", { headers: { Authorization: `Bearer ${SERVICE_KEY}` } });
        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("PERSONAL_KEY_NEEDS_ACCOUNT");
    });

    it("are refused to a guest", async () => {
        const token = await generateAccessToken("guest-1", [], "aal1", undefined, true);
        const res = await buildApp(makeStore(), true).request("/api/auth/keys", json({ name: "k", scopes: ["data:read"] }, token));
        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("PERSONAL_KEY_NEEDS_ACCOUNT");
    });
});
