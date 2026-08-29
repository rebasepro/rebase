import { describe, expect, it, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { generateAccessToken } from "../src/auth/jwt";

/**
 * Who may reach cron, logs and backups on a backend whose DATA is public.
 *
 * `auth.requireAuth: false` is the documented setting for a public website
 * reading its own backend — it hands row-level authorization to Postgres RLS
 * and stops demanding a token on `/api/data`. It used to also decide whether
 * the admin surfaces were gated at all, so taking that advice quietly mounted
 * the cron trigger, the log reader and the backup routes for anyone who could
 * reach the service. Only a `warn` at boot said so.
 *
 * These tests pin the two halves apart: a public data plane stays public, and
 * the admin surfaces are gated whenever authentication exists to gate them
 * with — including for the `rk_` admin keys that schedulers call cron with.
 */

const JWT_SECRET = "admin-surfaces-gate-test-secret-1234567890";
const CRONS_DIR = path.join(__dirname, "fixtures", "crons");

const ADMIN_API_KEY = "rk_admin_key_used_by_the_scheduler";
const SERVICE_API_KEY = "rk_non_admin_service_key";

function hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function apiKeyRow(token: string, admin: boolean): Record<string, unknown> {
    return {
        id: admin ? "key-admin" : "key-service",
        name: admin ? "scheduler" : "service",
        key_prefix: token.slice(0, 11),
        key_hash: hash(token),
        permissions: [],
        admin,
        rate_limit: null,
        created_by: "test",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        last_used_at: null,
        expires_at: null,
        revoked_at: null
    };
}

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" }
        }
    } as unknown as CollectionConfig;
}

/**
 * A driver that answers just enough SQL for the API key store: the lookup by
 * key hash. Everything else (DDL, cron bookkeeping) answers no rows.
 */
function stubDriver() {
    const keys = new Map<string, Record<string, unknown>>([
        [hash(ADMIN_API_KEY), apiKeyRow(ADMIN_API_KEY, true)],
        [hash(SERVICE_API_KEY), apiKeyRow(SERVICE_API_KEY, false)]
    ]);

    return {
        fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
        fetchEntity: async () => undefined,
        saveEntity: async () => ({}),
        deleteEntity: async () => undefined,
        countCollection: async () => 0,
        checkUniqueField: async () => true,
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        admin: {
            executeSql: async (sql: string, options?: { params?: unknown[] }) => {
                if (sql.includes("rebase.api_keys") && sql.includes("key_hash = $1")) {
                    const row = keys.get(String(options?.params?.[0]));
                    return row ? [row] : [];
                }
                return [];
            }
        }
    } as never;
}

const bootstrapper: BackendBootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return { driver: stubDriver(), collections: [], internals: {} } as unknown as InitializedDriver;
    },
    // Enough for the built-in auth adapter to be constructed. Nothing in these
    // tests logs in — the JWTs are minted directly.
    async initializeAuth() {
        return { userService: {}, authRepository: {} };
    }
} as unknown as BackendBootstrapper;

type Boot = { app: Hono; stop: () => void };

async function boot(auth: Record<string, unknown> | undefined): Promise<Boot> {
    const app = new Hono();
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("jobs")],
        cronsDir: CRONS_DIR,
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        ...(auth ? { auth } : {})
    } as never);
    return {
        app,
        // The scheduler holds timers; jest would otherwise not exit.
        stop: () => (backend as { cronScheduler?: { stop?: () => void } }).cronScheduler?.stop?.()
    };
}

/** The configuration this is all about: public data, real auth. */
const publicDataPlane = {
    requireAuth: false,
    jwtSecret: JWT_SECRET
};

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

const started: Boot[] = [];
async function bootTracked(auth: Record<string, unknown> | undefined): Promise<Hono> {
    const b = await boot(auth);
    started.push(b);
    return b.app;
}

afterEach(() => {
    while (started.length) started.pop()!.stop();
    jest.restoreAllMocks();
});

describe("admin surfaces on a backend with a public data plane", () => {
    it.each([
        ["cron", "/api/cron"],
        ["logs", "/api/logs?limit=1"],
        ["backups", "/api/admin/backups"]
    ])("answers 401 to an unauthenticated %s request", async (_surface, url) => {
        const app = await bootTracked(publicDataPlane);

        expect((await app.request(url)).status).toBe(401);
    });

    it("still lets an admin JWT through", async () => {
        const app = await bootTracked(publicDataPlane);
        const token = await generateAccessToken("admin-1", ["admin"]);

        expect((await app.request("/api/cron", bearer(token))).status).toBe(200);
    });

    it("refuses a signed-in non-admin with 403, not 401", async () => {
        const app = await bootTracked(publicDataPlane);
        const token = await generateAccessToken("editor-1", ["editor"]);

        expect((await app.request("/api/cron", bearer(token))).status).toBe(403);
    });

    it("lets an `rk_` admin API key through — the path schedulers call cron with", async () => {
        // The gate registers the API-key pre-auth ahead of the JWT check. Get
        // that order wrong and an `rk_` token is parsed as a JWT, fails, and
        // every scheduled job stops firing with a 401 nobody is watching for.
        const app = await bootTracked(publicDataPlane);

        expect((await app.request("/api/cron", bearer(ADMIN_API_KEY))).status).toBe(200);
    });

    it("refuses a non-admin `rk_` key with 403", async () => {
        const app = await bootTracked(publicDataPlane);

        expect((await app.request("/api/cron", bearer(SERVICE_API_KEY))).status).toBe(403);
    });

    it("leaves the data plane anonymous — that is what requireAuth: false buys", async () => {
        const app = await bootTracked(publicDataPlane);

        expect((await app.request("/api/data/jobs")).status).toBe(200);
    });

    it("serves the project contract, gated, instead of 404ing it", async () => {
        // `/contract` is only mounted when there is a gate to put on it, so it
        // used to disappear on exactly these deployments — taking typed client
        // generation with it.
        const app = await bootTracked(publicDataPlane);
        const token = await generateAccessToken("admin-1", ["admin"]);

        expect((await app.request("/api/meta/contract")).status).toBe(401);
        expect((await app.request("/api/meta/contract", bearer(token))).status).toBe(200);
    });
});

describe("admin surfaces when there is no authentication at all", () => {
    it.each([
        ["cron", "/api/cron"],
        ["logs", "/api/logs?limit=1"],
        ["backups", "/api/admin/backups"]
    ])("refuses %s with 501 rather than serving it open", async (_surface, url) => {
        // Nothing to check a caller against, so there is no request this server
        // can honour here. It used to serve them to anyone with a `warn` at boot
        // as the only defence.
        const app = await bootTracked(undefined);

        const res = await app.request(url);

        expect(res.status).toBe(501);
        expect((await res.json() as { error: { code: string } }).error.code)
            .toBe("ADMIN_SURFACE_UNAVAILABLE");
    });

    it("refuses a caller holding a token just the same — there is nothing to verify it against", async () => {
        const app = await bootTracked(undefined);

        const res = await app.request("/api/cron", bearer("anything-at-all"));

        expect(res.status).toBe(501);
    });

    it("names the fix, in the response and at boot", async () => {
        // A bare 404 or 401 here reads as a broken route or a bad token, and
        // gets debugged as one. Both messages say which switch is missing.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        const app = await bootTracked(undefined);
        const body = await (await app.request("/api/logs?limit=1")).json();

        expect((body as { error: { message: string } }).error.message).toMatch(/auth\.jwtSecret/);
        expect(warn.mock.calls.flat().join(" ")).toMatch(/mounted but DISABLED/);
    });

    it("is a different answer from the data plane's", async () => {
        // With no auth config at all, `requireAuth` defaults to true and the
        // data API answers 401 — "show me a token". The admin surfaces cannot
        // say that honestly, because no token would help, so they say 501.
        const app = await bootTracked(undefined);

        expect((await app.request("/api/data/jobs")).status).toBe(401);
        expect((await app.request("/api/cron")).status).toBe(501);
    });
});
