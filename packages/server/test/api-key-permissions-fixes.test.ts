/**
 * Tests for the permissions-system audit fixes:
 *
 * 1. `rk_` admin API keys reach admin surfaces via `createApiKeyPreAuth`
 *    composed with `createRequireAuth` + `requireAdmin` (previously the JWT
 *    gates parsed `rk_` tokens as invalid JWTs and 401'd).
 * 2. The builtin auth adapter no longer authenticates `?token=` query params.
 * 3. Subcollection routes enforce the API key permission of the TARGET
 *    collection, not the parent's.
 * 4. Custom-function invocations by API keys require a `functions` /
 *    `functions/<name>` permission entry (or the `*` wildcard).
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono, Context } from "hono";
import { createHash } from "crypto";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { requireAuth, requireAdmin, createRequireAuth } from "../src/auth/middleware";
import { createApiKeyPreAuth, createFunctionApiKeyGuard, createStorageApiKeyGuard } from "../src/auth/api-keys/api-key-middleware";
import { isFunctionAllowed } from "../src/auth/api-keys/api-key-permission-guard";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { AuthRepository } from "../src/auth/interfaces";
import type { ApiKeyStore } from "../src/auth/api-keys/api-key-store";
import type { ApiKey, ApiKeyMasked, ApiKeyPermission } from "../src/auth/api-keys/api-key-types";
import type { HonoEnv } from "../src/api/types";
import type { CollectionConfig, DataDriver, Entity } from "@rebasepro/types";

const TEST_SECRET = "test-secret-key-for-api-key-fixes-testing-1234567890";
const SERVICE_KEY = "service-key-for-api-key-fixes-tests-1234567890";

const ADMIN_KEY_TOKEN = "rk_fixture_admin_token_for_tests_aaaa";
const SCOPED_KEY_TOKEN = "rk_fixture_scoped_token_for_tests_bbbb";
const REVOKED_KEY_TOKEN = "rk_fixture_revoked_token_for_tests_cccc";

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

function makeStore(keys: ApiKey[]): ApiKeyStore {
    return {
        findByKeyHash: async (hash: string) => keys.find((k) => k.key_hash === hash) ?? null,
        updateLastUsed: async () => undefined
    } as unknown as ApiKeyStore;
}

// A driver without withAuth(): scopeDataDriver passes it through unchanged.
const bareDriver = {} as DataDriver;

beforeAll(() => {
    configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
});

// ── 1. Admin surfaces accept admin API keys ─────────────────────────────────

describe("admin surface gate (pre-auth + createRequireAuth + requireAdmin)", () => {
    const store = makeStore([
        makeKey(ADMIN_KEY_TOKEN, { admin: true }),
        makeKey(SCOPED_KEY_TOKEN, { permissions: [{ collection: "events",
operations: ["read"] }] }),
        makeKey(REVOKED_KEY_TOKEN, { admin: true,
revoked_at: new Date().toISOString() })
    ]);

    function adminApp() {
        const app = new Hono<HonoEnv>();
        app.use("/*", createApiKeyPreAuth({ store,
driver: bareDriver }));
        app.use("/*", createRequireAuth({ serviceKey: SERVICE_KEY }), requireAdmin);
        app.get("/thing", (c: Context<HonoEnv>) => c.json({ user: c.get("user") }));
        return app;
    }

    const request = (token: string) =>
        adminApp().request("/thing", { headers: { Authorization: `Bearer ${token}` } });

    it("grants an admin API key access to an admin surface", async () => {
        const res = await request(ADMIN_KEY_TOKEN);
        expect(res.status).toBe(200);
        const body = await res.json() as { user: { uid: string; roles: string[] } };
        expect(body.user.uid).toMatch(/^api-key:/);
        expect(body.user.roles).toContain("admin");
        expect(body.user.roles).toContain("service");
    });

    it("rejects a non-admin API key with 403 (authenticated, not authorized)", async () => {
        const res = await request(SCOPED_KEY_TOKEN);
        expect(res.status).toBe(403);
    });

    it("rejects a revoked admin API key with 401", async () => {
        const res = await request(REVOKED_KEY_TOKEN);
        expect(res.status).toBe(401);
    });

    it("rejects an unknown rk_ token with 401 instead of misparsing it as a JWT", async () => {
        const res = await request("rk_fixture_unknown_token_for_tests_ffff");
        expect(res.status).toBe(401);
    });

    it("still accepts an admin JWT through the same chain", async () => {
        const res = await request(await generateAccessToken("user-1", ["admin"]));
        expect(res.status).toBe(200);
    });

    it("still rejects a non-admin JWT with 403", async () => {
        const res = await request(await generateAccessToken("user-2", ["editor"]));
        expect(res.status).toBe(403);
    });

    it("still accepts the service key", async () => {
        const res = await request(SERVICE_KEY);
        expect(res.status).toBe(200);
        const body = await res.json() as { user: { uid: string } };
        expect(body.user.uid).toBe("service");
    });

    it("without pre-auth, an rk_ token is still rejected by the JWT gate", async () => {
        const app = new Hono<HonoEnv>();
        app.use("/*", requireAuth, requireAdmin);
        app.get("/thing", (c: Context<HonoEnv>) => c.json({ ok: true }));
        const res = await app.request("/thing", {
            headers: { Authorization: `Bearer ${ADMIN_KEY_TOKEN}` }
        });
        expect(res.status).toBe(401);
    });
});

// ── 2. Builtin adapter refuses query-string tokens ──────────────────────────

describe("builtin auth adapter query-token rejection", () => {
    const adapter = createBuiltinAuthAdapter({
        authRepository: {
            getUserRoleIds: async () => ["editor"]
        } as unknown as AuthRepository,
        serviceKey: SERVICE_KEY
    });

    it("does NOT authenticate a valid JWT passed as ?token=", async () => {
        const token = await generateAccessToken("user-1", ["admin"]);
        const user = await adapter.verifyRequest(new Request(`http://localhost/api/data/users?token=${token}`));
        expect(user).toBeNull();
    });

    it("does NOT authenticate the service key passed as ?token=", async () => {
        const user = await adapter.verifyRequest(
            new Request(`http://localhost/api/data/users?token=${encodeURIComponent(SERVICE_KEY)}`)
        );
        expect(user).toBeNull();
    });

    it("still authenticates a JWT via the Authorization header", async () => {
        const token = await generateAccessToken("user-1", ["admin"]);
        const user = await adapter.verifyRequest(new Request("http://localhost/api/data/users", {
            headers: { Authorization: `Bearer ${token}` }
        }));
        expect(user?.uid).toBe("user-1");
    });

    it("still authenticates the service key via the Authorization header", async () => {
        const user = await adapter.verifyRequest(new Request("http://localhost/api/data/users", {
            headers: { Authorization: `Bearer ${SERVICE_KEY}` }
        }));
        expect(user?.uid).toBe("service");
    });
});

// ── 3. Subcollection routes enforce the target collection ───────────────────

describe("subcollection API key scoping", () => {
    function createMockDriver(): DataDriver {
        return {
            fetchCollection: jest.fn<DataDriver["fetchCollection"]>().mockResolvedValue([]),
            fetchOne: jest.fn<DataDriver["fetchOne"]>().mockResolvedValue(undefined),
            save: jest.fn<DataDriver["save"]>().mockResolvedValue({ id: "1",
path: "posts",
values: {} } as unknown as Entity),
            delete: jest.fn<DataDriver["delete"]>().mockResolvedValue(undefined),
            count: jest.fn<NonNullable<DataDriver["count"]>>().mockResolvedValue(0)
        } as unknown as DataDriver;
    }

    function createTestCollection(slug: string): CollectionConfig {
        return { slug,
name: slug,
path: slug,
properties: {} } as unknown as CollectionConfig;
    }

    function createApp(permissions: ApiKeyPermission[]): Hono {
        const driver = createMockDriver();
        const parent = new Hono<HonoEnv>();
        parent.onError(errorHandler);
        parent.use("/*", async (c, next) => {
            c.set("driver", driver);
            c.set("apiKey", { id: "k1",
permissions } as unknown as ApiKeyMasked);
            await next();
        });
        const generator = new RestApiGenerator(
            [createTestCollection("authors"), createTestCollection("posts")],
            driver
        );
        parent.route("/", generator.generateRoutes());
        return parent as unknown as Hono;
    }

    it("allows /authors/1/posts for a key scoped to the target (posts)", async () => {
        const app = createApp([{ collection: "posts",
operations: ["read", "write"] }]);
        expect((await app.request("/authors/1/posts")).status).toBe(200);
        expect((await app.request("/authors/1/posts", {
            method: "POST",
            body: JSON.stringify({ title: "hi" }),
            headers: { "Content-Type": "application/json" }
        })).status).toBe(201);
    });

    it("rejects /authors/1/posts for a key scoped only to the parent (authors)", async () => {
        const app = createApp([{ collection: "authors",
operations: ["read", "write", "delete"] }]);
        const res = await app.request("/authors/1/posts");
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("API_KEY_FORBIDDEN");
    });

    it("still rejects the direct parent route for a child-scoped key", async () => {
        const app = createApp([{ collection: "posts",
operations: ["read"] }]);
        expect((await app.request("/authors")).status).toBe(403);
    });
});

// ── 4. Function invocation permissions ──────────────────────────────────────

describe("isFunctionAllowed", () => {
    const write: ApiKeyPermission["operations"] = ["write"];

    it("grants via the global wildcard", () => {
        expect(isFunctionAllowed([{ collection: "*",
operations: write }], "send-email", "write")).toBe(true);
    });

    it("grants via the functions namespace", () => {
        expect(isFunctionAllowed([{ collection: "functions",
operations: write }], "send-email", "write")).toBe(true);
    });

    it("grants a single function via functions/<name>", () => {
        const perms: ApiKeyPermission[] = [{ collection: "functions/send-email",
operations: write }];
        expect(isFunctionAllowed(perms, "send-email", "write")).toBe(true);
        expect(isFunctionAllowed(perms, "other-fn", "write")).toBe(false);
    });

    it("checks the operation, not just the resource", () => {
        const perms: ApiKeyPermission[] = [{ collection: "functions/send-email",
operations: ["read"] }];
        expect(isFunctionAllowed(perms, "send-email", "write")).toBe(false);
    });

    it("does not let a collection-scoped key invoke functions", () => {
        expect(isFunctionAllowed([{ collection: "events",
operations: ["read", "write", "delete"] }], "send-email", "write")).toBe(false);
    });

    it("only namespace-wide entries grant the functions index (empty name)", () => {
        expect(isFunctionAllowed([{ collection: "functions",
operations: ["read"] }], "", "read")).toBe(true);
        expect(isFunctionAllowed([{ collection: "functions/send-email",
operations: ["read"] }], "", "read")).toBe(false);
    });
});

describe("createFunctionApiKeyGuard", () => {
    function createApp(permissions: ApiKeyPermission[] | null) {
        const app = new Hono<HonoEnv>();
        if (permissions) {
            app.use("/*", async (c, next) => {
                c.set("apiKey", { id: "k1",
permissions } as unknown as ApiKeyMasked);
                await next();
            });
        }
        app.use("/api/functions/*", createFunctionApiKeyGuard("/api/functions"));
        app.all("/api/functions/:name", (c) => c.json({ invoked: c.req.param("name") }));
        return app;
    }

    it("lets non-API-key requests through untouched", async () => {
        const res = await createApp(null).request("/api/functions/send-email", { method: "POST" });
        expect(res.status).toBe(200);
    });

    it("allows a key with a matching functions/<name> permission", async () => {
        const app = createApp([{ collection: "functions/send-email",
operations: ["write"] }]);
        expect((await app.request("/api/functions/send-email", { method: "POST" })).status).toBe(200);
    });

    it("maps HTTP methods to operations (write permission does not grant GET)", async () => {
        const app = createApp([{ collection: "functions/send-email",
operations: ["write"] }]);
        expect((await app.request("/api/functions/send-email")).status).toBe(403);
    });

    it("rejects a collection-scoped key with 403", async () => {
        const app = createApp([{ collection: "events",
operations: ["read", "write", "delete"] }]);
        const res = await app.request("/api/functions/send-email", { method: "POST" });
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("API_KEY_FORBIDDEN");
    });

    it("allows a full-access (*) key", async () => {
        const app = createApp([{ collection: "*",
operations: ["read", "write", "delete"] }]);
        expect((await app.request("/api/functions/send-email", { method: "POST" })).status).toBe(200);
    });

    it("handles malformed percent-encoding with 403, not a 500", async () => {
        const app = createApp([{ collection: "functions/send-email",
operations: ["write"] }]);
        const res = await app.request("/api/functions/%ZZ", { method: "POST" });
        expect(res.status).toBe(403);
    });
});

// ── 5. Storage permissions for API keys ─────────────────────────────────────

describe("createStorageApiKeyGuard", () => {
    function createApp(permissions: ApiKeyPermission[] | null) {
        const app = new Hono<HonoEnv>();
        if (permissions) {
            app.use("/*", async (c, next) => {
                c.set("apiKey", { id: "k1",
permissions } as unknown as ApiKeyMasked);
                await next();
            });
        }
        app.use("/*", createStorageApiKeyGuard());
        app.all("/*", (c) => c.json({ ok: true }));
        return app;
    }

    it("lets non-API-key requests through untouched", async () => {
        expect((await createApp(null).request("/upload", { method: "POST" })).status).toBe(200);
    });

    it("allows a storage-scoped key for the matching operation", async () => {
        const app = createApp([{ collection: "storage",
operations: ["read", "write"] }]);
        expect((await app.request("/file/pic.png")).status).toBe(200);
        expect((await app.request("/upload", { method: "POST" })).status).toBe(200);
    });

    it("maps HTTP methods to operations (no delete permission → DELETE 403)", async () => {
        const app = createApp([{ collection: "storage",
operations: ["read", "write"] }]);
        expect((await app.request("/file/pic.png", { method: "DELETE" })).status).toBe(403);
    });

    it("rejects a collection-scoped key with 403", async () => {
        const app = createApp([{ collection: "events",
operations: ["read", "write", "delete"] }]);
        const res = await app.request("/file/pic.png");
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("API_KEY_FORBIDDEN");
    });

    it("classifies every TUS route as write so a write-only key can resume uploads", async () => {
        const app = createApp([{ collection: "storage",
operations: ["write"] }]);
        // The TUS offset check is a GET and cancel is a DELETE, but both are
        // steps of an upload — write permission must be sufficient.
        expect((await app.request("/tus/abc123")).status).toBe(200);
        expect((await app.request("/tus/abc123", { method: "DELETE" })).status).toBe(200);
        // ...while plain object reads still require "read".
        expect((await app.request("/file/pic.png")).status).toBe(403);
    });

    it("allows a full-access (*) key", async () => {
        const app = createApp([{ collection: "*",
operations: ["read", "write", "delete"] }]);
        expect((await app.request("/upload", { method: "POST" })).status).toBe(200);
    });
});

// ── 6. Storage upload body limit actually runs ──────────────────────────────
//
// Regression: init.ts used to register the upload bodyLimit with `use()`
// AFTER `createStorageRoutes()` had registered its handlers. Hono composes
// handlers in registration order, so the limit sat deeper than the route and
// never executed — uploads had no size cap at all. The wrapper router now
// registers it first; this test pins the ordering semantics.

describe("storage upload body limit ordering", () => {
    // This used to build two throwaway Hono apps and register a bodyLimit in
    // each order, which demonstrates how Hono composes middleware but never
    // touches init.ts — the file where the bug was and where it could return.
    // Both spellings stayed green forever. So the app under test is now the real
    // one, booted through `initializeRebaseBackend`, and the limit is the one
    // init.ts derives from `storage.maxFileSize`.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalForce = process.env.FORCE_LOCAL_STORAGE;
    let tempDir: string;

    beforeAll(async () => {
        const fs = await import("fs");
        const os = await import("os");
        const path = await import("path");
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-body-limit-"));
    });

    afterAll(async () => {
        const fs = await import("fs");
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        process.env.NODE_ENV = originalNodeEnv;
        if (originalForce === undefined) delete process.env.FORCE_LOCAL_STORAGE;
        else process.env.FORCE_LOCAL_STORAGE = originalForce;
    });

    async function bootWithUploadLimit(maxFileSize: number) {
        process.env.NODE_ENV = "development";
        const { initializeRebaseBackend } = await import("../src/init");
        const app = new Hono();
        await initializeRebaseBackend({
            app: app as never,
            server: {} as never,
            collections: [],
            bootstrappers: [{
                type: "fake",
                isDefault: true,
                async initializeDriver() {
                    return { driver: {} as never,
collections: [],
internals: {} };
                }
            }] as never,
            storage: { type: "local",
basePath: tempDir,
maxFileSize },
            storagePublicRead: true
        } as never);
        return app;
    }

    it("rejects a body over the configured maxFileSize with 413", async () => {
        const app = await bootWithUploadLimit(10);

        const res = await app.request("/api/storage/upload", {
            method: "POST",
            body: "x".repeat(100)
        });

        expect(res.status).toBe(413);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("runs the limit before the route's own auth gate", async () => {
        // The ordering is the whole point: a limit registered after the routes
        // sits deeper than them and never executes. An oversized *anonymous*
        // upload proves the limit ran first — otherwise the auth gate would
        // answer 401 and the body would already have been read in full.
        const app = await bootWithUploadLimit(10);

        const oversized = await app.request("/api/storage/upload", {
            method: "POST",
            body: "x".repeat(100)
        });
        const small = await app.request("/api/storage/upload", {
            method: "POST",
            body: "x"
        });

        expect(oversized.status).toBe(413);
        expect(small.status).not.toBe(413);
    });
});

// ── 7. Anonymous bucket can be disabled (public webhook functions) ──────────

describe("createDataRateLimiter with anonymous: null", () => {
    it("does not throttle anonymous requests but still throttles users", async () => {
        const { createDataRateLimiter } = await import("../src/auth/rate-limiter");
        const app = new Hono<HonoEnv>();
        let asUser = false;
        app.use("/*", async (c, next) => {
            if (asUser) c.set("user", { uid: "u1",
roles: [] });
            await next();
        });
        app.use("/*", createDataRateLimiter({ anonymous: null,
user: 1 }));
        app.post("/hook", (c) => c.json({ ok: true }));

        // Anonymous: repeated calls all pass — webhooks must not 429.
        for (let i = 0; i < 5; i++) {
            expect((await app.request("/hook", { method: "POST" })).status).toBe(200);
        }

        // Signed-in user: limited (limit 1 → second call 429).
        asUser = true;
        expect((await app.request("/hook", { method: "POST" })).status).toBe(200);
        expect((await app.request("/hook", { method: "POST" })).status).toBe(429);
    });
});
