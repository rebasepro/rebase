/**
 * The API key a request authenticated with reaches the driver's identity, so
 * collection callbacks can read it as `context.credential`.
 *
 * A personal key acts as its owner: the driver is scoped to the owner's uid,
 * and a hook saw the same `context.user` whether the owner saved by hand or a
 * CI job wrote with their key. An audit log built on the hooks recorded every
 * token write as the person. The key's kind, id and name now ride on the
 * identity every door scopes the driver with: both data-API middlewares and
 * `/mcp`. A session carries none.
 */
import { describe, it, expect, beforeAll, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { EMPTY_ACCESS_MODEL, type DataDriver } from "@rebasepro/types";
import type { ApiKeyStore } from "../src/auth/api-keys/api-key-store";
import type { ApiKey } from "../src/auth/api-keys/api-key-types";
import type { ApiKeyIdentity } from "../src/auth/api-keys/api-key-middleware";
import { configureJwt, generateAccessToken, generateMcpAccessToken } from "../src/auth/jwt";
import { createAuthMiddleware } from "../src/auth/middleware";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { configureAccess } from "../src/auth/access";
import type { AuthRepository } from "../src/auth/interfaces";
import { sha256Hex } from "../src/utils/portable-crypto";
import type { HonoEnv } from "../src/api/types";
import { buildApp, rpc, stubDriver, PUBLIC_URL } from "./helpers/mcp-harness";

const OWNER = "ada";

function recordingDriver() {
    const scopedAs: Record<string, unknown>[] = [];
    const driver = {
        key: "recording",
        initialised: true,
        withAuth: async (user: Record<string, unknown>) => {
            scopedAs.push(user);
            return driver;
        }
    } as unknown as DataDriver;
    return { driver, scopedAs };
}

function appWith(middleware: ReturnType<typeof createAuthMiddleware>) {
    const app = new Hono<HonoEnv>();
    app.use("/*", middleware);
    app.get("/data", (c) => c.json({ ok: true }));
    return app;
}

async function storedKey(plaintext: string, overrides: Partial<ApiKey>): Promise<ApiKey> {
    return {
        id: "key-1",
        name: "CI deploys",
        kind: "personal",
        key_prefix: plaintext.slice(0, 12),
        key_hash: await sha256Hex(plaintext),
        scopes: ["data:read", "data:write"],
        roles: [],
        owner_uid: OWNER,
        rate_limit: null,
        created_by: OWNER,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
        ...overrides
    };
}

function storeOf(...keys: ApiKey[]): ApiKeyStore {
    return {
        findByKeyHash: async (hash: string) => keys.find(key => key.key_hash === hash) ?? null,
        updateLastUsed: async () => undefined
    } as unknown as ApiKeyStore;
}

const repo = {
    getUserById: async (id: string) => (id === OWNER ? { id, email: "ada@example.test", emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) } : null),
    getUserRoleIds: async (id: string) => (id === OWNER ? ["editor"] : [])
} as unknown as AuthRepository;

const PERSONAL = "rk_test_personal_key_for_ci_0001";
const SERVICE = "rk_test_service_key_for_sync_0002";

beforeAll(() => {
    configureJwt({ secret: "credential-scope-secret-0123456789abcdef", accessExpiresIn: "1h" });
});

afterEach(() => {
    configureAccess({ model: EMPTY_ACCESS_MODEL });
});

describe.each([
    ["the adapter middleware", (driver: DataDriver, apiKeyStore: ApiKeyStore) =>
        createAdapterAuthMiddleware({ adapter: createBuiltinAuthAdapter({ authRepository: repo }), driver, apiKeyStore })],
    ["the JWT middleware", (driver: DataDriver, apiKeyStore: ApiKeyStore) =>
        createAuthMiddleware({ driver, apiKeyStore })]
] as const)("%s", (_name, middlewareFor) => {
    it("scopes a personal key's request as its owner, naming the key", async () => {
        configureAccess({ model: EMPTY_ACCESS_MODEL, resolveKeyOwner: async (uid) => (uid === OWNER ? { roles: ["editor"] } : null) });
        const { driver, scopedAs } = recordingDriver();
        const app = appWith(middlewareFor(driver, storeOf(await storedKey(PERSONAL, {}))));

        const res = await app.request("/data", { headers: { Authorization: `Bearer ${PERSONAL}` } });

        expect(res.status).toBe(200);
        expect(scopedAs.at(-1)).toEqual(expect.objectContaining({
            uid: OWNER,
            credential: { kind: "personal", id: "key-1", name: "CI deploys" }
        }));
    });

    it("names a service key too", async () => {
        const { driver, scopedAs } = recordingDriver();
        const app = appWith(middlewareFor(driver, storeOf(await storedKey(SERVICE, { id: "key-2", name: "nightly sync", kind: "service", owner_uid: null }))));

        const res = await app.request("/data", { headers: { Authorization: `Bearer ${SERVICE}` } });

        expect(res.status).toBe(200);
        expect(scopedAs.at(-1)).toEqual(expect.objectContaining({
            uid: "api-key:key-2",
            credential: { kind: "service", id: "key-2", name: "nightly sync" }
        }));
    });

    it("carries no credential for the owner's own session", async () => {
        const { driver, scopedAs } = recordingDriver();
        const app = appWith(middlewareFor(driver, storeOf()));

        const res = await app.request("/data", { headers: { Authorization: `Bearer ${await generateAccessToken(OWNER, ["editor"])}` } });

        expect(res.status).toBe(200);
        expect(scopedAs.at(-1)).toEqual(expect.objectContaining({ uid: OWNER }));
        expect(scopedAs.at(-1)).not.toHaveProperty("credential");
    });
});

describe("/mcp", () => {
    const keyIdentity: ApiKeyIdentity = {
        uid: OWNER,
        roles: ["editor"],
        scopes: ["data:read"],
        apiKey: { id: "key-1", name: "CI deploys", kind: "personal" } as ApiKeyIdentity["apiKey"]
    };
    const callQuery = (app: Parameters<typeof rpc>[0], bearer: string) => rpc(app, bearer, {
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "query_collection", arguments: { collection: "candidates" } }
    });

    it("scopes a tool call made with an API key with the key named", async () => {
        const { driver, scopedAs } = stubDriver();
        const { app } = buildApp({ driver, resolveApiKey: async () => keyIdentity });

        await callQuery(app, "rk_live_test");

        expect(scopedAs.at(-1)).toEqual(expect.objectContaining({
            uid: OWNER,
            credential: { kind: "personal", id: "key-1", name: "CI deploys" }
        }));
    });

    it("carries no credential for an OAuth connection, which is the person's own grant", async () => {
        const { driver, scopedAs } = stubDriver();
        const { app } = buildApp({ driver });
        const bearer = await generateMcpAccessToken({
            uid: OWNER, roles: ["editor"], scope: "data:read", clientId: "c", aud: `${PUBLIC_URL}/mcp`, iss: PUBLIC_URL
        }, 3600);

        await callQuery(app, bearer);

        expect(scopedAs.at(-1)).toEqual(expect.objectContaining({ uid: OWNER }));
        expect(scopedAs.at(-1)).not.toHaveProperty("credential");
    });
});
