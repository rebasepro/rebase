/**
 * API keys on every surface, in the scope vocabulary.
 *
 * 1. An `rk_` key reaches an admin surface through `createApiKeyPreAuth` +
 *    `createRequireAuth` + `requireScope`, when it holds the surface's scope —
 *    and a personal key does so as its owner, with the owner's roles as they
 *    are now.
 * 2. The builtin auth adapter never authenticates `?token=` query params.
 * 3. Subcollection routes check the TARGET collection's scope, and read on
 *    every parent the path passes through.
 * 4. Function calls by a key need `functions:invoke`, unqualified or on the
 *    function.
 * 5. The resumable-upload steps need `storage:write`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from "@jest/globals";
import { Hono, Context } from "hono";
import { createHash } from "crypto";
import { EMPTY_ACCESS_MODEL } from "@rebasepro/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { requireAuth, createRequireAuth } from "../src/auth/middleware";
import { configureAccess, requireScope } from "../src/auth/access";
import { createApiKeyPreAuth, createFunctionScopeGuard, createTusScopeGuard } from "../src/auth/api-keys/api-key-middleware";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { AuthRepository } from "../src/auth/interfaces";
import type { ApiKeyStore } from "../src/auth/api-keys/api-key-store";
import type { ApiKey, ApiKeyMasked } from "../src/auth/api-keys/api-key-types";
import type { HonoEnv } from "../src/api/types";
import type { CollectionConfig, DataDriver, Entity } from "@rebasepro/types";

const TEST_SECRET = "test-secret-key-for-api-key-fixes-testing-1234567890";
const SERVICE_KEY = "service-key-for-api-key-fixes-tests-1234567890";

const LOGS_KEY_TOKEN = "rk_fixture_logs_token_for_tests_aaaa";
const SCOPED_KEY_TOKEN = "rk_fixture_scoped_token_for_tests_bbbb";
const REVOKED_KEY_TOKEN = "rk_fixture_revoked_token_for_tests_cccc";
const PERSONAL_KEY_TOKEN = "rk_fixture_personal_token_for_tests_dddd";

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

afterEach(() => {
    configureAccess({ model: EMPTY_ACCESS_MODEL });
});

// ── 1. Admin surfaces take keys holding their scope ─────────────────────────

describe("admin surface gate (pre-auth + createRequireAuth + requireScope)", () => {
    const store = makeStore([
        makeKey(LOGS_KEY_TOKEN, { scopes: ["logs:read"], roles: ["admin"] }),
        makeKey(SCOPED_KEY_TOKEN, { scopes: ["data:read:events"] }),
        makeKey(REVOKED_KEY_TOKEN, { scopes: ["logs:read"], revoked_at: new Date().toISOString() }),
        makeKey(PERSONAL_KEY_TOKEN, { kind: "personal", owner_uid: "owner-1", scopes: ["logs:read", "data:read"] })
    ]);

    function adminApp() {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createApiKeyPreAuth({ store,
driver: bareDriver }));
        app.use("/*", createRequireAuth({ serviceKey: SERVICE_KEY }), requireScope("logs:read"));
        app.get("/thing", (c: Context<HonoEnv>) => c.json({ user: c.get("user"), scopes: c.get("scopes") ?? null }));
        return app;
    }

    const request = (token: string) =>
        adminApp().request("/thing", { headers: { Authorization: `Bearer ${token}` } });

    it("grants a service key holding the surface's scope", async () => {
        const res = await request(LOGS_KEY_TOKEN);
        expect(res.status).toBe(200);
        const body = await res.json() as { user: { uid: string; roles: string[] }; scopes: string[] };
        expect(body.user.uid).toMatch(/^api-key:/);
        // `service` always, plus the RLS roles the key was given.
        expect(body.user.roles).toEqual(["service", "admin"]);
        expect(body.scopes).toEqual(["logs:read"]);
    });

    it("refuses a key without the surface's scope with 403 SCOPE_MISSING", async () => {
        const res = await request(SCOPED_KEY_TOKEN);
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string; details: { requiredScope: string } } };
        expect(body.error.code).toBe("SCOPE_MISSING");
        expect(body.error.details.requiredScope).toBe("logs:read");
    });

    it("does not let an admin RLS role stand in for a missing scope", async () => {
        // Roles decide which rows a key reads; scopes decide which doors it
        // opens. A key that runs as `admin` and holds `data:read` alone is not
        // a key for the logs.
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createApiKeyPreAuth({
            store: makeStore([makeKey(SCOPED_KEY_TOKEN, { scopes: ["data:read"], roles: ["admin"] })]),
            driver: bareDriver
        }));
        app.use("/*", createRequireAuth({ serviceKey: SERVICE_KEY }), requireScope("logs:read"));
        app.get("/thing", (c) => c.json({ ok: true }));
        const res = await app.request("/thing", { headers: { Authorization: `Bearer ${SCOPED_KEY_TOKEN}` } });
        expect(res.status).toBe(403);
    });

    it("rejects a revoked key with 401", async () => {
        const res = await request(REVOKED_KEY_TOKEN);
        expect(res.status).toBe(401);
    });

    it("rejects an unknown rk_ token with 401 instead of misparsing it as a JWT", async () => {
        const res = await request("rk_fixture_unknown_token_for_tests_ffff");
        expect(res.status).toBe(401);
    });

    it("accepts an admin JWT through the same chain", async () => {
        const res = await request(await generateAccessToken("user-1", ["admin"]));
        expect(res.status).toBe(200);
    });

    it("refuses a JWT whose roles do not hold the scope", async () => {
        const res = await request(await generateAccessToken("user-2", ["editor"]));
        expect(res.status).toBe(403);
    });

    it("accepts a JWT whose declared role holds the scope", async () => {
        configureAccess({ model: { roles: { ops: { scopes: ["logs:read"] } }, scopes: {} } });
        const res = await request(await generateAccessToken("user-3", ["ops"]));
        expect(res.status).toBe(200);
    });

    it("accepts the service key", async () => {
        const res = await request(SERVICE_KEY);
        expect(res.status).toBe(200);
        const body = await res.json() as { user: { uid: string } };
        expect(body.user.uid).toBe("service");
    });

    it("without pre-auth, an rk_ token is still rejected by the JWT gate", async () => {
        const app = new Hono<HonoEnv>();
        app.use("/*", requireAuth, requireScope("logs:read"));
        app.get("/thing", (c: Context<HonoEnv>) => c.json({ ok: true }));
        const res = await app.request("/thing", {
            headers: { Authorization: `Bearer ${LOGS_KEY_TOKEN}` }
        });
        expect(res.status).toBe(401);
    });

    describe("personal keys", () => {
        const owners = new Map<string, string[]>();
        const enablePersonalKeys = () => configureAccess({
            model: { roles: { ops: { scopes: ["logs:read"] } }, scopes: {} },
            resolveKeyOwner: async (uid) => owners.has(uid) ? { roles: owners.get(uid)! } : null
        });

        it("acts as its owner, with the owner's roles", async () => {
            owners.set("owner-1", ["ops"]);
            enablePersonalKeys();
            const res = await request(PERSONAL_KEY_TOKEN);
            expect(res.status).toBe(200);
            const body = await res.json() as { user: { uid: string; roles: string[] }; scopes: string[] };
            expect(body.user).toEqual({ uid: "owner-1", roles: ["ops"] });
            expect(body.scopes).toEqual(["logs:read", "data:read"]);
        });

        it("shrinks with its owner: a demoted owner's key loses the scope", async () => {
            owners.set("owner-1", ["editor"]);
            enablePersonalKeys();
            const res = await request(PERSONAL_KEY_TOKEN);
            expect(res.status).toBe(403);
        });

        it("stops when its owner's account is gone", async () => {
            owners.clear();
            enablePersonalKeys();
            const res = await request(PERSONAL_KEY_TOKEN);
            expect(res.status).toBe(401);
            expect((await res.json() as { error: { message: string } }).error.message).toContain("no longer exists");
        });

        it("stops when personal keys are switched off", async () => {
            owners.set("owner-1", ["ops"]);
            configureAccess({ model: EMPTY_ACCESS_MODEL });
            const res = await request(PERSONAL_KEY_TOKEN);
            expect(res.status).toBe(401);
            expect((await res.json() as { error: { message: string } }).error.message).toContain("switched off");
        });
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

// ── 3. Subcollection routes check the target collection's scope ───────────────────

describe("subcollection data scopes", () => {
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

    const hasMany = (target: () => CollectionConfig, foreignKeyOnTarget: string) =>
        ({ type: "relation", relation: { kind: "hasMany", target, foreignKeyOnTarget } });

    function createApp(scopes: string[]): { app: Hono; driver: DataDriver } {
        const driver = createMockDriver();
        const parent = new Hono<HonoEnv>();
        parent.onError(errorHandler);
        parent.use("/*", async (c, next) => {
            c.set("driver", driver);
            c.set("apiKey", { id: "k1", scopes } as unknown as ApiKeyMasked);
            c.set("scopes", scopes);
            await next();
        });
        const posts = createTestCollection("posts");
        const authors = {
            ...createTestCollection("authors"),
            properties: { posts: hasMany(() => posts, "author_id") }
        } as unknown as CollectionConfig;
        // A relation named after one collection that targets another: the
        // name in the URL is `notes`, the rows are `internal_notes`.
        const notes = createTestCollection("notes");
        const internalNotes = createTestCollection("internal_notes");
        const projects = {
            ...createTestCollection("projects"),
            properties: { notes: hasMany(() => internalNotes, "project_id") }
        } as unknown as CollectionConfig;
        const generator = new RestApiGenerator([authors, posts, projects, notes, internalNotes], driver);
        parent.route("/", generator.generateRoutes());
        return { app: parent as unknown as Hono, driver };
    }

    const refusal = async (res: Response) => (await res.json() as { error: { code: string; message: string } }).error;

    it("allows /authors/1/posts for a key that may use the target and read the parent", async () => {
        const { app } = createApp(["data:read:posts", "data:write:posts", "data:read:authors"]);
        expect((await app.request("/authors/1/posts")).status).toBe(200);
        expect((await app.request("/authors/1/posts", {
            method: "POST",
            body: JSON.stringify({ title: "hi" }),
            headers: { "Content-Type": "application/json" }
        })).status).toBe(201);
    });

    it("rejects /authors/1/posts for a key scoped only to the parent (authors)", async () => {
        const { app } = createApp(["data:read:authors", "data:write:authors", "data:delete:authors"]);
        const res = await app.request("/authors/1/posts");
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe("SCOPE_MISSING");
    });

    it("rejects /authors/1/posts for a key that may not read the parent", async () => {
        // The path addresses "the posts of author 1": reaching them goes
        // through a row of a collection this key was never granted.
        const { app, driver } = createApp(["data:read:posts", "data:write:posts"]);

        const read = await app.request("/authors/1/posts");
        expect(read.status).toBe(403);
        expect((await refusal(read)).message).toContain('"data:read" for collection "authors"');

        const write = await app.request("/authors/1/posts", {
            method: "POST",
            body: JSON.stringify({ title: "hi" }),
            headers: { "Content-Type": "application/json" }
        });
        expect(write.status).toBe(403);
        expect(driver.save).not.toHaveBeenCalled();
    });

    it("checks the collection a relation targets, not the relation's name", async () => {
        // A key for `notes` is not a key for `internal_notes`, whatever the
        // relation that reaches them happens to be called.
        const { app, driver } = createApp(["data:read:notes", "data:read:projects"]);

        const res = await app.request("/projects/1/notes");

        expect(res.status).toBe(403);
        expect((await refusal(res)).message).toContain('collection "internal_notes"');
        expect(driver.fetchCollection).not.toHaveBeenCalled();
    });

    it("allows the same path for a key scoped to the target collection", async () => {
        const { app } = createApp(["data:read:internal_notes", "data:read:projects"]);

        expect((await app.request("/projects/1/notes")).status).toBe(200);
    });

    it("asks the target for the route's own operation, and the parent only for read", async () => {
        // A delete through a parent removes a row of the target; the parent row
        // is only read to get there. The 404 is the mock having no such row —
        // the request got past the key.
        const { app } = createApp(["data:delete:posts", "data:read:authors"]);

        const res = await app.request("/authors/1/posts/5", { method: "DELETE" });

        expect(res.status).toBe(404);
        expect((await refusal(res)).code).toBe("NOT_FOUND");
    });

    it("still rejects the direct parent route for a child-scoped key", async () => {
        const { app } = createApp(["data:read:posts"]);
        expect((await app.request("/authors")).status).toBe(403);
    });
});

// ── 4. Function invocation scopes ───────────────────────────────────────────

describe("createFunctionScopeGuard", () => {
    function createApp(scopes: string[] | null) {
        const app = new Hono<HonoEnv>();
        if (scopes) {
            app.use("/*", async (c, next) => {
                c.set("apiKey", { id: "k1", scopes } as unknown as ApiKeyMasked);
                c.set("scopes", scopes);
                await next();
            });
        }
        app.use("/api/functions/*", createFunctionScopeGuard("/api/functions"));
        app.all("/api/functions", (c) => c.json({ index: true }));
        app.all("/api/functions/:name", (c) => c.json({ invoked: c.req.param("name") }));
        return app;
    }

    it("lets a person's request through untouched", async () => {
        const res = await createApp(null).request("/api/functions/send-email", { method: "POST" });
        expect(res.status).toBe(200);
    });

    it("allows a key holding functions:invoke on the function", async () => {
        const app = createApp(["functions:invoke:send-email"]);
        expect((await app.request("/api/functions/send-email", { method: "POST" })).status).toBe(200);
        // Invoking is invoking, whatever the method.
        expect((await app.request("/api/functions/send-email")).status).toBe(200);
    });

    it("refuses another function", async () => {
        const app = createApp(["functions:invoke:send-email"]);
        const res = await app.request("/api/functions/other-fn", { method: "POST" });
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string; details: { requiredScope: string } } };
        expect(body.error.code).toBe("SCOPE_MISSING");
        expect(body.error.details.requiredScope).toBe("functions:invoke:other-fn");
    });

    it("refuses a key holding only data scopes", async () => {
        const app = createApp(["data:read", "data:write", "data:delete"]);
        expect((await app.request("/api/functions/send-email", { method: "POST" })).status).toBe(403);
    });

    it("allows the unqualified scope everywhere", async () => {
        const app = createApp(["functions:invoke"]);
        expect((await app.request("/api/functions/send-email", { method: "POST" })).status).toBe(200);
    });

    it("handles malformed percent-encoding with 403, not a 500", async () => {
        const app = createApp(["functions:invoke:send-email"]);
        const res = await app.request("/api/functions/%ZZ", { method: "POST" });
        expect(res.status).toBe(403);
    });
});

// ── 5. Resumable-upload steps need storage:write ────────────────────────────

describe("createTusScopeGuard", () => {
    function createApp(scopes: string[] | null) {
        const app = new Hono<HonoEnv>();
        app.use("/*", async (c, next) => {
            c.set("user", { uid: "u1", roles: [] });
            if (scopes) c.set("scopes", scopes);
            await next();
        });
        app.use("/*", createTusScopeGuard());
        app.all("/*", (c) => c.json({ ok: true }));
        return app;
    }

    it("lets a person's request through", async () => {
        expect((await createApp(null).request("/tus/abc123", { method: "PATCH" })).status).toBe(200);
    });

    it("treats every step of an upload as a write", async () => {
        // The offset check is a GET and cancel is a DELETE, but both are steps
        // of an upload — storage:write is what they need.
        const app = createApp(["storage:write:media"]);
        expect((await app.request("/tus/abc123")).status).toBe(200);
        expect((await app.request("/tus/abc123", { method: "DELETE" })).status).toBe(200);
        expect((await app.request("/tus/abc123", { method: "PATCH" })).status).toBe(200);
    });

    it("refuses a read-only key", async () => {
        const app = createApp(["storage:read"]);
        expect((await app.request("/tus/abc123", { method: "PATCH" })).status).toBe(403);
    });

    it("leaves other storage routes to the per-operation check", async () => {
        const app = createApp(["data:read"]);
        expect((await app.request("/file/pic.png")).status).toBe(200);
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

// ── 8. verifyCredential: one answer for a socket or tunnel of the app's own ─

describe("verifyCredential", () => {
    it("answers a session token with the user's roles and their scopes", async () => {
        const { verifyCredential } = await import("../src/auth/verify-credential");
        configureAccess({ model: { roles: { ops: { scopes: ["logs:read"] } }, scopes: {} } });
        const verified = await verifyCredential(await generateAccessToken("u9", ["ops"]));
        expect(verified).toEqual(expect.objectContaining({ uid: "u9", roles: ["ops"], kind: "session" }));
        expect(verified?.scopes).toEqual(expect.arrayContaining(["data:read", "logs:read"]));
    });

    it("answers an API key with what the key holds", async () => {
        const { verifyCredential, configureCredentialStore } = await import("../src/auth/verify-credential");
        configureCredentialStore(makeStore([makeKey(SCOPED_KEY_TOKEN, { scopes: ["data:read:events"] })]));
        try {
            expect(await verifyCredential(SCOPED_KEY_TOKEN)).toEqual(expect.objectContaining({
                uid: "api-key:id-bbbb", roles: ["service"], scopes: ["data:read:events"], kind: "api-key"
            }));
            expect(await verifyCredential("rk_unknown_key")).toBeNull();
        } finally {
            configureCredentialStore(undefined);
        }
    });

    it("refuses a key where there is no key store, and garbage everywhere", async () => {
        const { verifyCredential } = await import("../src/auth/verify-credential");
        expect(await verifyCredential(SCOPED_KEY_TOKEN)).toBeNull();
        expect(await verifyCredential("not-a-token")).toBeNull();
        expect(await verifyCredential("")).toBeNull();
    });
});
